import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  TransactionInstruction,
} from "@solana/web3.js";
import { PythSolanaReceiver } from "./idl/pyth_solana_receiver";
import Idl from "./idl/pyth_solana_receiver.json";
import {
  WormholeCoreBridgeSolana,
  IDL as WormholeCoreBridgeSolanaIdl,
} from "./idl/wormhole_core_bridge_solana";
import {
  DEFAULT_RECEIVER_PROGRAM_ID,
  DEFAULT_WORMHOLE_PROGRAM_ID,
  getConfigPda,
  getGuardianSetPda,
  getTreasuryPda,
} from "./address";
import { PublicKey, Keypair } from "@solana/web3.js";
import { parseAccumulatorUpdateData } from "@pythnetwork/price-service-sdk";
import { DEFAULT_TREASURY_ID, VAA_SPLIT_INDEX, VAA_START } from "./constants";
import { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { getGuardianSetIndex } from "./vaa";

export class PythSolanaReceiverConnection {
  readonly connection: Connection;
  readonly wallet: Wallet;
  private readonly provider: AnchorProvider;
  readonly receiver: Program<PythSolanaReceiver>;
  readonly wormhole: Program<WormholeCoreBridgeSolana>;

  constructor({
    connection,
    wallet,
  }: {
    connection: Connection;
    wallet: Wallet;
  }) {
    this.connection = connection;
    this.wallet = wallet;
    this.provider = new AnchorProvider(this.connection, this.wallet, {});
    this.receiver = new Program<PythSolanaReceiver>(
      Idl as PythSolanaReceiver,
      DEFAULT_RECEIVER_PROGRAM_ID,
      this.provider
    );
    this.wormhole = new Program<WormholeCoreBridgeSolana>(
      WormholeCoreBridgeSolanaIdl as WormholeCoreBridgeSolana,
      DEFAULT_WORMHOLE_PROGRAM_ID,
      this.provider
    );
  }

  async postPriceUpdate(vaa: string): Promise<PublicKey> {
    const accumulatorUpdateData = parseAccumulatorUpdateData(
      Buffer.from(vaa, "base64")
    );

    const encodedVaaKeypair = new Keypair();
    const encodedVaaSize = accumulatorUpdateData.vaa.length + VAA_START;

    const guardianSetIndex = getGuardianSetIndex(accumulatorUpdateData.vaa);

    const firstTransactionInstructions: TransactionInstruction[] = [
      await this.wormhole.account.encodedVaa.createInstruction(
        encodedVaaKeypair,
        encodedVaaSize
      ),
      await this.wormhole.methods
        .initEncodedVaa()
        .accounts({
          encodedVaa: encodedVaaKeypair.publicKey,
        })
        .instruction(),
    ];

    // First transaction
    const firstTransaction = await this.wormhole.methods
      .writeEncodedVaa({
        index: 0,
        data: accumulatorUpdateData.vaa.subarray(0, VAA_SPLIT_INDEX),
      })
      .accounts({
        draftVaa: encodedVaaKeypair.publicKey,
      })
      .preInstructions(firstTransactionInstructions)
      .signers([encodedVaaKeypair])
      .transaction();

    const priceUpdateKeypair = new Keypair();
    const secondTransactionInstructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }),
      await this.wormhole.methods
        .writeEncodedVaa({
          index: VAA_SPLIT_INDEX,
          data: accumulatorUpdateData.vaa.subarray(VAA_SPLIT_INDEX),
        })
        .accounts({
          draftVaa: encodedVaaKeypair.publicKey,
        })
        .instruction(),
      await this.wormhole.methods
        .verifyEncodedVaaV1()
        .accounts({
          guardianSet: getGuardianSetPda(guardianSetIndex),
          draftVaa: encodedVaaKeypair.publicKey,
        })
        .instruction(),
    ];

    // Second transaction
    const secondTransaction = await this.receiver.methods
      .postUpdate({
        merklePriceUpdate: accumulatorUpdateData.updates[0],
        treasuryId: DEFAULT_TREASURY_ID,
      })
      .accounts({
        encodedVaa: encodedVaaKeypair.publicKey,
        priceUpdateAccount: priceUpdateKeypair.publicKey,
        treasury: getTreasuryPda(DEFAULT_TREASURY_ID),
        config: getConfigPda(),
      })
      .signers([priceUpdateKeypair])
      .preInstructions(secondTransactionInstructions)
      .transaction();

    await this.provider.sendAll(
      [
        { tx: firstTransaction, signers: [encodedVaaKeypair] },
        { tx: secondTransaction, signers: [priceUpdateKeypair] },
      ],
      { skipPreflight: true }
    );
    return priceUpdateKeypair.publicKey;
  }
}
