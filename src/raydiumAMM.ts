import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Liquidity,
  LiquidityPoolKeys,
  TokenAmount,
  Token,
  Percent,
  SPL_MINT_LAYOUT,
  jsonInfo2PoolKeys,
  Market,
  buildSimpleTransaction,
  TxVersion,
  LOOKUP_TABLE_CACHE,
  DEVNET_PROGRAM_ID,
  ApiPoolInfoV4,
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  MarketV2,
  TokenAccount,
  SPL_ACCOUNT_LAYOUT,
} from "@raydium-io/raydium-sdk";
import BN from "bn.js";

////////////////////////////////////////////////////////////////////////////////
// Use the actual SDK type
export type RaydiumPoolKeys = LiquidityPoolKeys;

// Utility function to get wallet token accounts
async function getWalletTokenAccount(
  connection: Connection,
  wallet: PublicKey
): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

export class RaydiumAMMManager {
  private connection: Connection;
  private payer: Keypair;

  constructor(connection: Connection, payer: Keypair) {
    this.connection = connection;
    this.payer = payer;
  }

  /**
   * Create a new OpenBook market using Raydium SDK V1
   * @param baseMint Base token mint address
   * @param quoteMint Quote token mint address
   * @returns Market ID of the created market
   */
  async createMarket(
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseDecimal: number = 9,
    quoteDecimal: number = 9,
    lotSize: number = 1,
    tickSize: number = 0.01
  ): Promise<PublicKey> {
    try {
      console.log("Creating OpenBook market...");

      // Create a new OpenBook market
      const market = await MarketV2.makeCreateMarketInstructionSimple({
        connection: this.connection,
        wallet: this.payer.publicKey,
        baseInfo: {
          mint: baseMint,
          decimals: baseDecimal, // Assuming 9 decimals for base token
        },
        quoteInfo: {
          mint: quoteMint,
          decimals: quoteDecimal, // Assuming 9 decimals for quote token
        },
        lotSize: lotSize,
        tickSize: tickSize,
        dexProgramId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET,
        makeTxVersion: TxVersion.V0,
      });

      // Build and send transaction
      // Don't use lookup tables on devnet as they may not exist
      const isDevnet = this.connection.rpcEndpoint.includes("devnet");
      const transactions = await buildSimpleTransaction({
        connection: this.connection,
        makeTxVersion: TxVersion.V0,
        payer: this.payer.publicKey,
        innerTransactions: market.innerTransactions,
        addLookupTableInfo: isDevnet ? undefined : LOOKUP_TABLE_CACHE,
      });

      const txids: string[] = [];
      for (const tx of transactions) {
        const txid = await this.sendTransactionV2(tx);
        txids.push(txid);
        console.log(`Transaction sent: ${txid}`);
      }
      console.log(`OpenBook market created successfully!`);

      const marketId = market.address.marketId;
      console.log(`Market ID: ${marketId.toString()}`);
      return marketId;
    } catch (error) {
      console.error("Error creating OpenBook market:", error);
      throw error;
    }
  }

  /**
   * Create a AMM pool using Raydium SDK V1
   */
  async createAMMPool(
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseAmount: number,
    quoteAmount: number,
    baseDecimal: number = 6,
    quoteDecimal: number = 6,
    marketId: PublicKey, // Required for V1 - must be a valid OpenBook market
    startTime?: BN // Optional start time for pool
  ): Promise<{
    poolKeys: RaydiumPoolKeys;
    txids: string[];
  }> {
    try {
      console.log("Creating AMM pool with Raydium SDK V1...");
      console.log(`Base token: ${baseMint.toString()}`);
      console.log(`Quote token: ${quoteMint.toString()}`);
      console.log(`Market ID: ${marketId.toString()}`);
      console.log(`Base amount: ${baseAmount}`);
      console.log(`Quote amount: ${quoteAmount}`);

      // Create Token instances
      const baseToken = new Token(
        TOKEN_PROGRAM_ID,
        baseMint,
        baseDecimal,
        "BASE",
        "Base Token"
      );
      const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        quoteMint,
        quoteDecimal,
        "QUOTE",
        "Quote Token"
      );

      // Convert amounts to TokenAmount with proper decimals
      const baseTokenAmount = new TokenAmount(
        baseToken,
        new BN(baseAmount).mul(new BN(10).pow(new BN(baseDecimal)))
      );
      const quoteTokenAmount = new TokenAmount(
        quoteToken,
        new BN(quoteAmount).mul(new BN(10).pow(new BN(quoteDecimal)))
      );

      // Get wallet token accounts
      const walletTokenAccounts = await getWalletTokenAccount(
        this.connection,
        this.payer.publicKey
      );

      // Create pool instruction using SDK V1
      const { address, innerTransactions } =
        await Liquidity.makeCreatePoolV4InstructionV2Simple({
          connection: this.connection,
          programId: DEVNET_PROGRAM_ID.AmmV4,
          marketInfo: {
            marketId: marketId,
            programId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET,
          },
          baseMintInfo: {
            mint: baseMint,
            decimals: baseDecimal,
          },
          quoteMintInfo: {
            mint: quoteMint,
            decimals: quoteDecimal,
          },
          baseAmount: baseTokenAmount.raw,
          quoteAmount: quoteTokenAmount.raw,
          startTime: startTime || new BN(Math.floor(Date.now() / 1000)),
          ownerInfo: {
            feePayer: this.payer.publicKey,
            wallet: this.payer.publicKey,
            tokenAccounts: walletTokenAccounts,
            useSOLBalance: quoteMint.equals(Token.WSOL.mint),
          },
          associatedOnly: false,
          checkCreateATAOwner: true,
          makeTxVersion: TxVersion.V0,
          feeDestinationId: new PublicKey(
            "3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR"
          ), // dev net fee destination
        });

      // Build and send transaction
      // Don't use lookup tables on devnet as they may not exist
      const isDevnet = this.connection.rpcEndpoint.includes("devnet");
      const transactions = await buildSimpleTransaction({
        makeTxVersion: TxVersion.V0,
        payer: this.payer.publicKey,
        connection: this.connection,
        innerTransactions: innerTransactions,
        addLookupTableInfo: isDevnet ? undefined : LOOKUP_TABLE_CACHE,
      });

      // Sign and send transaction
      const txids: string[] = [];
      for (const tx of transactions) {
        const txid = await this.sendTransactionV2(tx);
        txids.push(txid);
        console.log(`Transaction sent: ${txid}`);
      }

      console.log(`AMM pool created successfully!`);

      const targetPoolInfo = await this.formatAmmKeysByAddr(address.ammId);
      const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as RaydiumPoolKeys;

      return {
        poolKeys,
        txids,
      };
    } catch (error) {
      console.error("Error creating AMM pool:", error);
      throw error;
    }
  }

  /**
   * Add liquidity to an existing pool using SDK V1
   */
  async addLiquidity(
    poolKeys: RaydiumPoolKeys,
    baseAmount: number,
    quoteAmount: number
  ): Promise<string[]> {
    try {
      console.log("Adding liquidity to pool...");
      console.log(`Pool ID: ${poolKeys.id.toString()}`);
      console.log(`Base amount: ${baseAmount}, Quote amount: ${quoteAmount}`);

      const [baseDecimal, quoteDecimal] = [
        poolKeys.baseDecimals,
        poolKeys.quoteDecimals,
      ];

      // Create Token instances
      const baseToken = new Token(
        TOKEN_PROGRAM_ID,
        poolKeys.baseMint,
        baseDecimal,
        "BASE",
        "Base Token"
      );
      const quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        poolKeys.quoteMint,
        quoteDecimal,
        "QUOTE",
        "Quote Token"
      );

      // Convert amounts to proper format
      const baseAmountIn = new TokenAmount(
        baseToken,
        new BN(baseAmount).mul(new BN(10).pow(new BN(baseDecimal)))
      );
      const quoteAmountIn = new TokenAmount(
        quoteToken,
        new BN(quoteAmount).mul(new BN(10).pow(new BN(quoteDecimal)))
      );

      // Get wallet token accounts
      const walletTokenAccounts = await getWalletTokenAccount(
        this.connection,
        this.payer.publicKey
      );

      // Create add liquidity instruction
      const { innerTransactions } =
        await Liquidity.makeAddLiquidityInstructionSimple({
          connection: this.connection,
          poolKeys,
          userKeys: {
            owner: this.payer.publicKey,
            payer: this.payer.publicKey,
            tokenAccounts: walletTokenAccounts,
          },
          amountInA: baseAmountIn,
          amountInB: quoteAmountIn,
          fixedSide: "a",
          makeTxVersion: TxVersion.V0,
        });

      // Build and send transaction
      // Don't use lookup tables on devnet as they may not exist
      const isDevnet = this.connection.rpcEndpoint.includes("devnet");
      const transactions = await buildSimpleTransaction({
        connection: this.connection,
        makeTxVersion: TxVersion.V0,
        payer: this.payer.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: isDevnet ? undefined : LOOKUP_TABLE_CACHE,
      });

      const txids: string[] = [];
      for (const tx of transactions) {
        const txid = await this.sendTransactionV2(tx);
        txids.push(txid);
        console.log(`Transaction sent: ${txid}`);
      }

      console.log(`Liquidity added successfully. Transaction: ${txids}`);
      return txids;
    } catch (error) {
      console.error("Error adding liquidity:", error);
      throw error;
    }
  }

  /**
   * Perform a token swap using Raydium SDK V1
   */
  async swapTokens(
    poolKeys: RaydiumPoolKeys,
    inputTokenMint: PublicKey,
    outputTokenMint: PublicKey,
    inputAmount: number,
    slippageTolerance: number = 0.01
  ): Promise<{
    txids: string[];
    outputAmount: number;
  }> {
    try {
      console.log("Performing token swap with Raydium SDK V1...");
      console.log(`Input: ${inputAmount} of ${inputTokenMint.toString()}`);
      console.log(`Output token: ${outputTokenMint.toString()}`);
      console.log(`Slippage tolerance: ${slippageTolerance * 100}%`);

      // Get pool info
      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys,
      });

      const [inputDecimal, outputDecimal] = [
        poolKeys.baseMint.equals(inputTokenMint)
          ? poolKeys.baseDecimals
          : poolKeys.quoteDecimals,
        poolKeys.baseMint.equals(outputTokenMint)
          ? poolKeys.baseDecimals
          : poolKeys.quoteDecimals,
      ];

      // Create Token instances
      const inputToken = new Token(
        TOKEN_PROGRAM_ID,
        inputTokenMint,
        inputDecimal,
        "INPUT",
        "Input Token"
      );
      const outputToken = new Token(
        TOKEN_PROGRAM_ID,
        outputTokenMint,
        outputDecimal,
        "OUTPUT",
        "Output Token"
      );

      // Convert input amount
      const inputTokenAmount = new TokenAmount(
        inputToken,
        new BN(inputAmount).mul(new BN(10).pow(new BN(inputDecimal)))
      );

      // Calculate output amount
      const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn: inputTokenAmount,
        currencyOut: outputToken,
        slippage: new Percent(Math.floor(slippageTolerance * 10000), 10000),
      });

      // Get wallet token accounts
      const walletTokenAccounts = await getWalletTokenAccount(
        this.connection,
        this.payer.publicKey
      );

      // Create swap instruction
      const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
        connection: this.connection,
        poolKeys,
        userKeys: {
          tokenAccounts: walletTokenAccounts,
          owner: this.payer.publicKey,
          payer: this.payer.publicKey,
        },
        amountIn: inputTokenAmount,
        amountOut: minAmountOut,
        fixedSide: "in",
        makeTxVersion: TxVersion.V0,
      });

      // Build and send transaction
      // Don't use lookup tables on devnet as they may not exist
      const isDevnet = this.connection.rpcEndpoint.includes("devnet");
      const transactions = await buildSimpleTransaction({
        connection: this.connection,
        makeTxVersion: TxVersion.V0,
        payer: this.payer.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: isDevnet ? undefined : LOOKUP_TABLE_CACHE,
      });

      const txids: string[] = [];
      for (const tx of transactions) {
        const txid = await this.sendTransactionV2(tx);
        txids.push(txid);
        console.log(`Transaction sent: ${txid}`);
      }

      const outputAmountNumber = Number(amountOut.toFixed()) / Math.pow(10, 9);

      console.log(`Swap completed successfully!`);
      console.log(`Transaction: ${txids.join(", ")}`);
      console.log(`Output amount: ${outputAmountNumber}`);

      return {
        txids,
        outputAmount: outputAmountNumber,
      };
    } catch (error) {
      console.error("Error performing swap:", error);
      throw error;
    }
  }

  /**
   * Get pool information using Raydium SDK V1
   */
  async getPoolInfo(poolKeys: RaydiumPoolKeys): Promise<any> {
    try {
      console.log(`Getting pool information for: ${poolKeys.id.toString()}`);

      const poolInfo = await Liquidity.fetchInfo({
        connection: this.connection,
        poolKeys,
      });

      console.log("Pool information retrieved successfully");
      console.log(`Base Reserve: ${poolInfo.baseReserve.toString()}`);
      console.log(`Quote Reserve: ${poolInfo.quoteReserve.toString()}`);
      console.log(`LP Supply: ${poolInfo.lpSupply.toString()}`);

      return poolInfo;
    } catch (error) {
      console.error("Error getting pool info:", error);
      throw error;
    }
  }

  /**
   * Remove liquidity from a pool using Raydium SDK V1
   */
  async removeLiquidity(
    poolKeys: RaydiumPoolKeys,
    lpTokenAmount: number
  ): Promise<string> {
    try {
      console.log("Removing liquidity from pool...");
      console.log(`Pool ID: ${poolKeys.id.toString()}`);
      console.log(`LP token amount: ${lpTokenAmount}`);

      const lpDecimal = poolKeys.lpDecimals;

      // Create LP token instance
      const lpToken = new Token(
        TOKEN_PROGRAM_ID,
        poolKeys.lpMint,
        lpDecimal,
        "LP",
        "LP Token"
      );
      const lpTokenAmountInput = new TokenAmount(
        lpToken,
        new BN(lpTokenAmount).mul(new BN(10).pow(new BN(lpDecimal)))
      );

      // Get wallet token accounts
      const walletTokenAccounts = await getWalletTokenAccount(
        this.connection,
        this.payer.publicKey
      );

      // Create remove liquidity instruction
      const { innerTransactions } =
        await Liquidity.makeRemoveLiquidityInstructionSimple({
          connection: this.connection,
          poolKeys,
          userKeys: {
            owner: this.payer.publicKey,
            payer: this.payer.publicKey,
            tokenAccounts: walletTokenAccounts,
          },
          amountIn: lpTokenAmountInput,
          makeTxVersion: TxVersion.V0,
        });

      // Build and send transaction
      // Don't use lookup tables on devnet as they may not exist
      const isDevnet = this.connection.rpcEndpoint.includes("devnet");
      const transactions = await buildSimpleTransaction({
        connection: this.connection,
        makeTxVersion: TxVersion.V0,
        payer: this.payer.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: isDevnet ? undefined : LOOKUP_TABLE_CACHE,
      });

      const txid = await this.sendTransactionV2(transactions[0]);

      console.log(`Liquidity removed successfully. Transaction: ${txid}`);
      return txid;
    } catch (error) {
      console.error("Error removing liquidity:", error);
      throw error;
    }
  }

  /**
   * Get the current price from the pool using real pool data
   */
  async getPrice(poolKeys: RaydiumPoolKeys): Promise<number> {
    try {
      console.log("Getting current price from pool...");
      console.log(`Pool ID: ${poolKeys.id.toString()}`);

      const poolInfo = await this.getPoolInfo(poolKeys);

      // Calculate price based on reserves
      const baseReserve = poolInfo.baseReserve;
      const quoteReserve = poolInfo.quoteReserve;

      // Price = quoteReserve / baseReserve (quote tokens per base token)
      const price = quoteReserve.toNumber() / baseReserve.toNumber();

      console.log(`Current price: ${price} (quote per base)`);

      return price;
    } catch (error) {
      console.error("Error getting price:", error);
      throw error;
    }
  }

  //////////////////////////////////////////////////////////////////////////////

  /**
   * Helper method to send and confirm transactions with proper typing
   */
  private async sendTransactionV2(
    transaction: VersionedTransaction | Transaction
  ): Promise<string> {
    try {
      if (transaction instanceof VersionedTransaction) {
        // Handle VersionedTransaction
        transaction.sign([this.payer]);
        const txid = await this.connection.sendTransaction(transaction, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        // Confirm transaction
        const confirmation = await this.connection.confirmTransaction(
          txid,
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        return txid;
      } else {
        // Handle legacy Transaction
        const txid = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.payer],
          {
            commitment: "confirmed",
          }
        );
        return txid;
      }
    } catch (error) {
      console.error("Error sending transaction:", error);
      throw error;
    }
  }

  /**
   * Format AMM keys by address for V4 pools
   */
  private async formatAmmKeysByAddr(addr: PublicKey): Promise<ApiPoolInfoV4> {
    const account = await this.connection.getAccountInfo(addr);
    if (account === null) throw Error(" get id info error ");
    const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);

    const marketId = info.marketId;
    const marketAccount = await this.connection.getAccountInfo(marketId);
    if (marketAccount === null) throw Error(" get market info error");
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

    const lpMint = info.lpMint;
    const lpMintAccount = await this.connection.getAccountInfo(lpMint);
    if (lpMintAccount === null) throw Error(" get lp mint info error");
    const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data);

    return {
      id: addr.toString(),
      baseMint: info.baseMint.toString(),
      quoteMint: info.quoteMint.toString(),
      lpMint: info.lpMint.toString(),
      baseDecimals: info.baseDecimal.toNumber(),
      quoteDecimals: info.quoteDecimal.toNumber(),
      lpDecimals: lpMintInfo.decimals,
      version: 4,
      programId: account.owner.toString(),
      authority: Liquidity.getAssociatedAuthority({
        programId: account.owner,
      }).publicKey.toString(),
      openOrders: info.openOrders.toString(),
      targetOrders: info.targetOrders.toString(),
      baseVault: info.baseVault.toString(),
      quoteVault: info.quoteVault.toString(),
      withdrawQueue: info.withdrawQueue.toString(),
      lpVault: info.lpVault.toString(),
      marketVersion: 3,
      marketProgramId: info.marketProgramId.toString(),
      marketId: info.marketId.toString(),
      marketAuthority: Market.getAssociatedAuthority({
        programId: info.marketProgramId,
        marketId: info.marketId,
      }).publicKey.toString(),
      marketBaseVault: marketInfo.baseVault.toString(),
      marketQuoteVault: marketInfo.quoteVault.toString(),
      marketBids: marketInfo.bids.toString(),
      marketAsks: marketInfo.asks.toString(),
      marketEventQueue: marketInfo.eventQueue.toString(),
      lookupTableAccount: PublicKey.default.toString(),
    };
  }
}
