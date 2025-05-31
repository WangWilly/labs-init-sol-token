import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
} from "@solana/spl-token";
import {
  Umi,
  keypairIdentity,
  PublicKey as UmiPublicKey,
  SolAmount,
  PublicKey as UmiPublicKeyType,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createV1,
  TokenStandard,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";

////////////////////////////////////////////////////////////////////////////////

export class SolanaTokenProgram {
  private connection: Connection;
  private payer: Keypair;
  private mint: PublicKey | null = null;
  private tokenDecimals: number = 9;
  private umi: Umi;

  constructor(connection: Connection, payer: Keypair) {
    this.connection = connection;
    this.payer = payer;

    // Initialize Umi client
    this.umi = createUmi(connection);

    // Convert Keypair to Umi format and set as identity
    const umiKeypair = this.umi.eddsa.createKeypairFromSecretKey(
      this.payer.secretKey
    );
    this.umi.use(keypairIdentity(umiKeypair));
    this.umi.use(mplTokenMetadata());
  }

  /**
   * Instruction 1: Create a fungible token with custom decimals and supply
   */
  async createToken(
    decimals: number = 9,
    initialSupply: number = 1000000
  ): Promise<PublicKey> {
    try {
      console.log("Creating token mint...");

      // Create mint
      this.mint = await createMint(
        this.connection,
        this.payer,
        this.payer.publicKey, // mint authority
        this.payer.publicKey, // freeze authority
        decimals
      );

      this.tokenDecimals = decimals;
      console.log(`Token mint created: ${this.mint.toString()}`);

      // Create associated token account for the payer
      const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.payer,
        this.mint,
        this.payer.publicKey
      );

      // Mint initial supply to payer
      const mintAmount = initialSupply * Math.pow(10, decimals);
      await mintTo(
        this.connection,
        this.payer,
        this.mint,
        payerTokenAccount.address,
        this.payer.publicKey,
        mintAmount
      );

      console.log(
        `Minted ${initialSupply} tokens to ${payerTokenAccount.address.toString()}`
      );
      return this.mint;
    } catch (error) {
      console.error("Error creating token:", error);
      throw error;
    }
  }

  /**
   * Instruction 2: Transfer tokens and SOL based on percentage BPS
   */
  async distributeTokensAndSol(
    percentBps: number, // basis points (10000 = 100%)
    solAmount: number, // in SOL
    newAccountPubkey: PublicKey,
    newAccountAtaPubkey?: PublicKey
  ): Promise<{
    newAccountPubkey: PublicKey;
    ataAddress: PublicKey;
    tokenAmount: number;
    solAmount: number;
  }> {
    try {
      const mintToUse = this.mint;
      if (!mintToUse) {
        throw new Error("No mint available. Create a token first.");
      }

      console.log("Distributing tokens and SOL...");

      // Get payer's token account
      const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.payer,
        mintToUse,
        this.payer.publicKey
      );

      // Get payer's token balance
      const balance = await this.connection.getTokenAccountBalance(
        payerTokenAccount.address
      );
      const totalTokens = parseInt(balance.value.amount);

      // Calculate token amount to transfer based on BPS
      const tokenAmountToTransfer = Math.floor(
        (totalTokens * percentBps) / 10000
      );
      if (tokenAmountToTransfer <= 0) {
        throw new Error(
          "Calculated token amount to transfer is zero or negative."
        );
      }

      // Create ATA for new account
      if (!newAccountAtaPubkey) {
        const newAccountAta = await getOrCreateAssociatedTokenAccount(
          this.connection,
          this.payer,
          mintToUse,
          newAccountPubkey
        );
        console.log(
          `Created ATA for new account: ${newAccountAta.address.toString()}`
        );

        newAccountAtaPubkey = newAccountAta.address;
      }

      let tx = new Transaction();

      // Transfer tokens
      if (tokenAmountToTransfer > 0) {
        const transferIx = createTransferInstruction(
          payerTokenAccount.address,
          newAccountAtaPubkey,
          this.payer.publicKey,
          tokenAmountToTransfer,
          [],
          TOKEN_PROGRAM_ID
        );
        tx = tx.add(transferIx);
        console.log(
          `Prepared to transfer ${tokenAmountToTransfer} tokens to ${newAccountAtaPubkey.toString()}`
        );
      }

      // Transfer SOL
      if (solAmount > 0) {
        const transferSolIx = SystemProgram.transfer({
          fromPubkey: this.payer.publicKey,
          toPubkey: newAccountPubkey,
          lamports: solAmount * LAMPORTS_PER_SOL,
        });

        tx = tx.add(transferSolIx);
        console.log(
          `Prepared to transfer ${solAmount} SOL to ${newAccountPubkey.toString()}`
        );
      }

      // Sign and send transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.payer],
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      console.log(`Transaction confirmed with signature: ${signature}`);

      return {
        newAccountPubkey: newAccountPubkey,
        ataAddress: newAccountAtaPubkey,
        tokenAmount: tokenAmountToTransfer / Math.pow(10, this.tokenDecimals),
        solAmount: solAmount,
      };
    } catch (error) {
      console.error("Error distributing tokens and SOL:", error);
      throw error;
    }
  }

  /**
   * Instruction 3: Create token metadata using Metaplex Token Metadata
   */
  async createTokenMetadata(
    name: string,
    symbol: string,
    metadataUri?: string
  ): Promise<string> {
    try {
      if (!this.mint) {
        throw new Error("No mint available. Create a token first.");
      }

      console.log("Creating token metadata...");

      // Convert Solana PublicKey to Umi PublicKey format
      const mintUmiKey = this.mint.toString() as UmiPublicKey;

      // Create the metadata account
      const createMetadataIx = createV1(this.umi, {
        mint: mintUmiKey,
        authority: this.umi.identity,
        name: name,
        symbol: symbol,
        uri: metadataUri || "",
        sellerFeeBasisPoints: {
          basisPoints: BigInt(0),
          identifier: "%",
          decimals: 2,
        },
        decimals: this.tokenDecimals,
        tokenStandard: TokenStandard.Fungible,
        collection: { __option: "None" },
        uses: { __option: "None" },
        creators: { __option: "None" },
        ruleSet: { __option: "None" },
        primarySaleHappened: false,
        isMutable: true,
        collectionDetails: { __option: "None" },
      });

      // Send the transaction
      const result = await createMetadataIx.sendAndConfirm(this.umi);
      console.log(`Metadata created with signature: ${result.signature}`);

      // Return the transaction signature
      return result.signature.toString();
    } catch (error) {
      console.error("Error creating token metadata:", error);
      throw error;
    }
  }

  /**
   * Get account balances
   */
  async getAccountBalances(
    account: PublicKey,
    tokenMint?: PublicKey
  ): Promise<{
    solBalance: number;
    tokenBalance: number;
  }> {
    try {
      // Get SOL balance
      const solBalance = await this.connection.getBalance(account);
      let tokenBalance = 0;

      // Get token balance if mint is provided
      if (tokenMint) {
        try {
          const tokenAccount = await getOrCreateAssociatedTokenAccount(
            this.connection,
            this.payer,
            tokenMint,
            account,
            true // allowOwnerOffCurve
          );
          const balance = await this.connection.getTokenAccountBalance(
            tokenAccount.address
          );
          tokenBalance = parseFloat(balance.value.uiAmount?.toString() || "0");
        } catch (error) {
          // Token account might not exist
          tokenBalance = 0;
        }
      }

      return {
        solBalance: solBalance / LAMPORTS_PER_SOL,
        tokenBalance: tokenBalance,
      };
    } catch (error) {
      console.error("Error getting account balances:", error);
      throw error;
    }
  }

  /**
   * Get token metadata information
   */
  async getTokenMetadata(): Promise<{
    exists: true;
    data: Uint8Array;
    executable: boolean;
    owner: UmiPublicKeyType;
    lamports: SolAmount;
    rentEpoch?: bigint;
    publicKey: UmiPublicKeyType;
  }> {
    try {
      const mintToUse = this.mint;
      if (!mintToUse) {
        throw new Error("No mint provided or available.");
      }

      console.log("Fetching token metadata...");

      // Convert to Umi PublicKey format
      const mintUmiKey = mintToUse.toString() as UmiPublicKey;

      // Fetch metadata account
      const metadataAccount = await this.umi.rpc.getAccount(mintUmiKey);

      if (!metadataAccount.exists) {
        throw new Error("Metadata account does not exist");
      }

      console.log(`Found metadata for mint: ${mintToUse.toString()}`);
      return metadataAccount;
    } catch (error) {
      console.error("Error fetching token metadata:", error);
      throw error;
    }
  }

  //////////////////////////////////////////////////////////////////////////////

  // Getter methods
  getMint(): PublicKey | null {
    return this.mint;
  }

  getConnection(): Connection {
    return this.connection;
  }

  getPayer(): Keypair {
    return this.payer;
  }

  getUmi(): Umi {
    return this.umi;
  }
}
