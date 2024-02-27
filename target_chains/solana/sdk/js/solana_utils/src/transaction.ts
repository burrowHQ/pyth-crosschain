import {
  Connection,
  PACKET_DATA_SIZE,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export type InstructionWithEphemeralSigners = {
  instruction: TransactionInstruction;
  signers: Signer[];
};

/**
 * Get the size of a transaction that would contain the provided array of instructions
 */
export function getSizeOfTransaction(
  instructions: TransactionInstruction[],
  versionedTransaction = true
): number {
  const signers = new Set<string>();
  const accounts = new Set<string>();

  instructions.map((ix) => {
    accounts.add(ix.programId.toBase58()),
      ix.keys.map((key) => {
        if (key.isSigner) {
          signers.add(key.pubkey.toBase58());
        }
        accounts.add(key.pubkey.toBase58());
      });
  });

  const instruction_sizes: number = instructions
    .map(
      (ix) =>
        1 +
        getSizeOfCompressedU16(ix.keys.length) +
        ix.keys.length +
        getSizeOfCompressedU16(ix.data.length) +
        ix.data.length
    )
    .reduce((a, b) => a + b, 0);

  return (
    1 +
    signers.size * 64 +
    3 +
    getSizeOfCompressedU16(accounts.size) +
    32 * accounts.size +
    32 +
    getSizeOfCompressedU16(instructions.length) +
    instruction_sizes +
    (versionedTransaction ? 1 + getSizeOfCompressedU16(0) : 0)
  );
}

/**
 * Get the size of n in bytes when serialized as a CompressedU16
 */
export function getSizeOfCompressedU16(n: number) {
  return 1 + Number(n >= 128) + Number(n >= 16384);
}

/**
 * This class is helpful for batching instructions into transactions in an efficient way.
 * As you add instructions, it adds them to the current transactions until it's full, then it starts a new transaction.
 */
export class TransactionBuilder {
  readonly transactionInstructions: {
    instructions: TransactionInstruction[];
    signers: Signer[];
  }[] = [];
  readonly payer: PublicKey;
  readonly connection: Connection;

  constructor(payer: PublicKey, connection: Connection) {
    this.payer = payer;
    this.connection = connection;
  }

  /**
   * Add an instruction to the builder, the signers argument can be used to specify ephemeral signers that need to sign the transaction
   * where this instruction appears
   */
  addInstruction(args: InstructionWithEphemeralSigners) {
    const { instruction, signers } = args;
    if (this.transactionInstructions.length === 0) {
      this.transactionInstructions.push({
        instructions: [instruction],
        signers: signers,
      });
    } else if (
      getSizeOfTransaction([
        ...this.transactionInstructions[this.transactionInstructions.length - 1]
          .instructions,
        instruction,
      ]) <= PACKET_DATA_SIZE
    ) {
      this.transactionInstructions[
        this.transactionInstructions.length - 1
      ].instructions.push(instruction);
      this.transactionInstructions[
        this.transactionInstructions.length - 1
      ].signers.push(...signers);
    } else
      this.transactionInstructions.push({
        instructions: [instruction],
        signers: signers,
      });
  }

  addInstructions(instructions: InstructionWithEphemeralSigners[]) {
    for (const { instruction, signers } of instructions) {
      this.addInstruction({ instruction, signers });
    }
  }

  /**
   * Returns all the added instructions batched into transactions, plus for each transaction the ephemeral signers that need to sign it
   */
  async getVersionedTransactions(): Promise<
    { tx: VersionedTransaction; signers: Signer[] }[]
  > {
    const blockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return this.transactionInstructions.map(({ instructions, signers }) => {
      return {
        tx: new VersionedTransaction(
          new TransactionMessage({
            recentBlockhash: blockhash,
            instructions: instructions,
            payerKey: this.payer,
          }).compileToV0Message()
        ),
        signers: signers,
      };
    });
  }

  /**
   * Returns all the added instructions batched into transactions, plus for each transaction the ephemeral signers that need to sign it
   */
  getLegacyTransactions(): { tx: Transaction; signers: Signer[] }[] {
    return this.transactionInstructions.map(({ instructions, signers }) => {
      return {
        tx: new Transaction().add(...instructions),
        signers: signers,
      };
    });
  }

  static batchIntoLegacyTransactions(
    instructions: TransactionInstruction[]
  ): Transaction[] {
    const transactionBuilder = new TransactionBuilder(
      PublicKey.unique(),
      new Connection("http://placeholder.placeholder")
    ); // We only need wallet and connection for `VersionedTransaction` so we can put placeholders here
    for (const instruction of instructions) {
      transactionBuilder.addInstruction({ instruction, signers: [] });
    }
    return transactionBuilder.getLegacyTransactions().map(({ tx }) => {
      return tx;
    });
  }
}
