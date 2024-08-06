import os from "os";
import path from "path";
import fs from "fs";

import {
  IPricePusher,
  PriceInfo,
  ChainPriceListener,
  PriceItem,
} from "../interface";
import {
  PriceServiceConnection,
  HexString,
} from "@pythnetwork/price-service-client";
import { DurationInSeconds } from "../utils";

import { Account, Connection, KeyPair, providers } from "near-api-js";
import {
  ExecutionStatus,
  ExecutionStatusBasic,
  FinalExecutionOutcome,
} from "near-api-js/lib/providers/provider";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores";
import { Action, SignedTransaction, functionCall, signTransaction, stringifyJsonOrBytes } from "near-api-js/lib/transaction";
import { base_decode } from "near-api-js/lib/utils/serialize";
import { v4 as uuidv4 } from "uuid";

export class NearPriceListener extends ChainPriceListener {
  constructor(
    private account: NearAccount,
    priceItems: PriceItem[],
    config: {
      pollingFrequency: DurationInSeconds;
    }
  ) {
    super("near", config.pollingFrequency, priceItems);
  }

  async getOnChainPriceInfo(priceId: string): Promise<PriceInfo | undefined> {
    try {
      const priceRaw = await this.account.getPriceUnsafe(priceId);

      console.log(
        `Polled a NEAR on chain price for feed ${this.priceIdToAlias.get(
          priceId
        )} (${priceId}) ${JSON.stringify(priceRaw)}.`
      );

      if (priceRaw) {
        return {
          conf: priceRaw.conf,
          price: priceRaw.price,
          publishTime: priceRaw.publish_time,
        };
      } else {
        return undefined;
      }
    } catch (e) {
      console.error(`Polling on-chain price for ${priceId} failed. Error:`);
      console.error(e);
      return undefined;
    }
  }
}

export class NearPricePusher implements IPricePusher {
  constructor(
    private account: NearAccount,
    private connection: PriceServiceConnection
  ) { }

  async updatePriceFeed(
    priceIds: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _pubTimesToPush: number[]
  ): Promise<void> {

    const updateId = uuidv4();
    let priceFeedUpdateData;
    try {
      priceFeedUpdateData = await this.getPriceFeedsUpdateData(priceIds);
    } catch (e: any) {
      console.error(new Date(), `[UM] (${updateId}) [${priceIds}]`, "getPriceFeedsUpdateData failed:", e);
      return;
    }

    for (const data of priceFeedUpdateData) {
      let updateFee;
      try {
        updateFee = await this.account.getUpdateFeeEstimate(data);
        console.log(`Update fee: ${updateFee}`);
      } catch (e: any) {
        console.error(new Date(), `[UM] (${updateId}) [${priceIds}]`, "getUpdateFeeEstimate failed:", e);
        continue;
      }

      try {
        console.log(new Date(), `[UM] (${updateId}) [${priceIds}]`, "begin update");
        await this.account.updatePriceFeeds(updateId, priceIds, data, updateFee);
      } catch (e: any) {
        console.error(new Date(), `[UM] (${updateId}) [${priceIds}]`, "updatePriceFeeds failed:", e);
      }
    }
  }

  private async getPriceFeedsUpdateData(
    priceIds: HexString[]
  ): Promise<string[]> {
    const latestVaas = await this.connection.getLatestVaas(priceIds);
    return latestVaas.map((vaa) => Buffer.from(vaa, "base64").toString("hex"));
  }
}

export class NearAccount {
  private account: Account;
  private standbyNodeUrls: string[] | undefined;

  constructor(
    network: string,
    accountId: string,
    nodeUrl: string,
    privateKeyPath: string | undefined,
    standbyNodeUrls: string | undefined,
    private standbyNodeRetryNumber: number,
    private pythAccountId: string
  ) {
    const connection = this.getConnection(
      network,
      accountId,
      nodeUrl,
      privateKeyPath
    );
    this.account = new Account(connection, accountId);
    this.standbyNodeUrls = standbyNodeUrls ? standbyNodeUrls.split(',') : undefined;
    this.standbyNodeUrls?.push(nodeUrl);
  }

  async getPriceUnsafe(priceId: string): Promise<any> {
    return await this.account.viewFunction({
      contractId: this.pythAccountId,
      methodName: "get_price_unsafe",
      args: {
        price_identifier: priceId,
      },
    });
  }

  async getUpdateFeeEstimate(data: string): Promise<any> {
    return await this.account.viewFunction({
      contractId: this.pythAccountId,
      methodName: "get_update_fee_estimate",
      args: {
        data,
      },
    });
  }

  async updatePriceFeeds(
    updateId: string,
    priceIds: string[],
    data: string,
    updateFee: any
  ) {
    if (this.standbyNodeUrls) {
      await this.sendTransactionWithMutliRpcs(updateId, priceIds, this.pythAccountId, "update_price_feeds", { data }, updateFee);
    } else {
      const outcome = await this.account.functionCall({
        contractId: this.pythAccountId,
        methodName: "update_price_feeds",
        args: {
          data,
        },
        gas: "300000000000000" as any,
        attachedDeposit: updateFee,
      });
      const [is_success, failureMessages] = checkOutcome(outcome);
      if (is_success) {
        console.log(
          new Date(),
          `[UM] (${updateId}) [${priceIds}]`,
          "updatePriceFeeds tx successful. Tx hash: ",
          outcome["transaction"]["hash"]
        );
      } else {
        console.error(
          new Date(),
          `[UM] (${updateId}) [${priceIds}]`,
          "updatePriceFeeds tx failed:",
          JSON.stringify(failureMessages, undefined, 2)
        );
      }
    }
  }

  private getConnection(
    network: string,
    accountId: string,
    nodeUrl: string,
    privateKeyPath: string | undefined
  ): Connection {
    const content = fs.readFileSync(
      privateKeyPath ||
      path.join(
        os.homedir(),
        ".near-credentials",
        network,
        accountId + ".json"
      )
    );
    const accountInfo = JSON.parse(content.toString());
    let privateKey = accountInfo.private_key;
    if (!privateKey && accountInfo.secret_key) {
      privateKey = accountInfo.secret_key;
    }
    if (accountInfo.account_id && privateKey) {
      const keyPair = KeyPair.fromString(privateKey);
      const keyStore = new InMemoryKeyStore();
      keyStore.setKey(network, accountInfo.account_id, keyPair);
      return Connection.fromConfig({
        networkId: network,
        provider: { type: "JsonRpcProvider", args: { url: nodeUrl } },
        signer: { type: "InMemorySigner", keyStore },
        jsvmAccountId: `jsvm.${network}`,
      });
    } else {
      throw new Error("Invalid key file!");
    }
  }

  async sendTransactionWithMutliRpcs(updateId: string, priceIds: string[], contractId: string, methodName: string, args: object, attachedDeposit: any) {
    const actions: Action[] = [functionCall(methodName, args, '300000000000000' as any, attachedDeposit, stringifyJsonOrBytes, false)];
    this.account.accessKeyByPublicKeyCache = {};
    const accessKeyInfo = await this.account.findAccessKey(contractId, actions);
    if (!accessKeyInfo) {
      console.error(new Date(), `[UM] (${updateId}) [${priceIds}]`, `Can not sign transactions for account ${this.account.accountId} on network ${this.account.connection.networkId}, no matching key pair exists for this account`, 'KeyNotFound');
      return;
    }
    const { accessKey } = accessKeyInfo;
    const block = await this.account.connection.provider.block({ finality: 'final' });
    const blockHash = block.header.hash;
    const nonce = accessKey.nonce.addn(1);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, signedTx] = await signTransaction(contractId, nonce, actions, base_decode(blockHash), this.account.connection.signer, this.account.accountId, this.account.connection.networkId);
    for (const i in this.standbyNodeUrls) {
      processTransaction(updateId, priceIds, this.standbyNodeUrls[i as any], signedTx, this.standbyNodeRetryNumber);
    }
  }
}

async function processTransaction(updateId: string, priceIds: string[], url: string, signedTx: SignedTransaction, retryNumber: number) {
  let outcome = undefined;
  const provider = new providers.JsonRpcProvider({ url });
  for (let i = 0; i < retryNumber; i++) {
    try {
      outcome = await provider.sendTransaction(signedTx);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [is_success, failureMessages] = checkOutcome(outcome);
      if (is_success) {
        console.log(
          new Date(),
          `[UM] (${updateId}) [${priceIds}]`,
          "updatePriceFeeds tx successful. nodeUrl:", url, "Tx hash: ",
          outcome["transaction"]["hash"]
        );
      } else {
        console.error(
          new Date(),
          `[UM] (${updateId}) [${priceIds}]`,
          "nodeUrl:", url,
          "updatePriceFeeds tx failed:",
          JSON.stringify(failureMessages, undefined, 2)
        );
      }
      break;
    } catch (error: any) {
      if (error.type === 'InvalidNonce') {
        console.error(new Date(), `[UM] (${updateId}) [${priceIds}]`, "nodeUrl:", url, "updatePriceFeeds InvalidNonce failed:", error);
        break;
      }
      if (i == retryNumber - 1){
        console.error(new Date(), `[UM] (${updateId}) [${priceIds}]`, "nodeUrl:", url, "updatePriceFeeds failed:", error);
      }
    }
  }
}

function checkOutcome(outcome: FinalExecutionOutcome): [boolean, (ExecutionStatus | ExecutionStatusBasic)[]] {
  const failureMessages: (ExecutionStatus | ExecutionStatusBasic)[] = [];
  const is_success = Object.values(outcome["receipts_outcome"]).reduce(
    (is_success, receipt) => {
      if (
        Object.prototype.hasOwnProperty.call(
          receipt["outcome"]["status"],
          "Failure"
        )
      ) {
        failureMessages.push(receipt["outcome"]["status"]);
        return false;
      }
      return is_success;
    },
    true
  );
  return [is_success, failureMessages]
}
