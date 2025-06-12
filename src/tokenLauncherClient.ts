import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Load the IDL
const idlPath = path.join(__dirname, '../target/idl/token_launcher.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as any;

// Note: Replace with actual deployed program ID
export const PROGRAM_ID = new PublicKey('GQwwtMLV9P2ywbAqA9dAKxZjKT6NzMrwfqqFVsaCvGEF');

export interface TokenLaunchConfig {
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  initialPrice: number; // in lamports per token
  maxSupply: number;
}

export interface LauncherState {
  authority: PublicKey;
  mint: PublicKey;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  currentPrice: BN;
  maxSupply: BN;
  totalMinted: BN;
  solCollected: BN;
  bump: number;
  vaultBump: number;
}

export class TokenLauncherClient {
  private program: any;

  constructor(
    readonly provider: AnchorProvider
  ) {
    // Create program with explicit program ID to avoid IDL parsing issues
    this.program = new Program(idl, provider);
    // Override the programId if it's not correctly parsed
    if (this.program.programId.toString() !== PROGRAM_ID.toString()) {
      console.log('Overriding program ID...');
      this.program.programId = PROGRAM_ID;
    }
  }

  /**
   * Initialize a new token launcher
   */
  async initializeTokenLauncher(
    authority: Keypair,
    config: TokenLaunchConfig
  ): Promise<{ mint: PublicKey; launcherState: PublicKey; signature: string }> {
    const mint = Keypair.generate();
    
    // Derive PDA addresses
    const [launcherState] = PublicKey.findProgramAddressSync(
      [Buffer.from('launcher'), mint.publicKey.toBuffer()],
      PROGRAM_ID
    );
    
    const [solVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('sol_vault'), mint.publicKey.toBuffer()],
      PROGRAM_ID
    );

    const tx = await this.program.methods
      .initializeTokenLauncher(
        config.tokenName,
        config.tokenSymbol,
        config.tokenDecimals,
        new BN(config.initialPrice),
        new BN(config.maxSupply)
      )
      .accounts({
        authority: authority.publicKey,
        launcherState,
        mint: mint.publicKey,
        solVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([authority, mint])
      .rpc();

    return {
      mint: mint.publicKey,
      launcherState,
      signature: tx,
    };
  }

  /**
   * Buy tokens with SOL
   */
  async buyTokens(
    buyer: Keypair,
    mint: PublicKey,
    solAmount: number
  ): Promise<string> {
    const [launcherState] = PublicKey.findProgramAddressSync(
      [Buffer.from('launcher'), mint.toBuffer()],
      PROGRAM_ID
    );
    
    const [solVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('sol_vault'), mint.toBuffer()],
      PROGRAM_ID
    );
    
    const buyerTokenAccount = await getAssociatedTokenAddress(
      mint,
      buyer.publicKey
    );

    const tx = await this.program.methods
      .buyTokens(new BN(solAmount))
      .accounts({
        buyer: buyer.publicKey,
        launcherState,
        mint,
        buyerTokenAccount,
        solVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();

    return tx;
  }

  /**
   * Sell tokens for SOL
   */
  async sellTokens(
    seller: Keypair,
    mint: PublicKey,
    tokenAmount: number
  ): Promise<string> {
    const [launcherState] = PublicKey.findProgramAddressSync(
      [Buffer.from('launcher'), mint.toBuffer()],
      PROGRAM_ID
    );
    
    const [solVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('sol_vault'), mint.toBuffer()],
      PROGRAM_ID
    );
    
    const sellerTokenAccount = await getAssociatedTokenAddress(
      mint,
      seller.publicKey
    );

    const tx = await this.program.methods
      .sellTokens(new BN(tokenAmount))
      .accounts({
        seller: seller.publicKey,
        launcherState,
        mint,
        sellerTokenAccount,
        solVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc();

    return tx;
  }

  /**
   * Withdraw collected SOL (authority only)
   */
  async withdrawSol(
    authority: Keypair,
    mint: PublicKey,
    amount: number
  ): Promise<string> {
    const [launcherState] = PublicKey.findProgramAddressSync(
      [Buffer.from('launcher'), mint.toBuffer()],
      PROGRAM_ID
    );
    
    const [solVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('sol_vault'), mint.toBuffer()],
      PROGRAM_ID
    );

    const tx = await this.program.methods
      .withdrawSol(new BN(amount))
      .accounts({
        authority: authority.publicKey,
        launcherState,
        mint,
        solVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    return tx;
  }

  /**
   * Get launcher state
   */
  async getLauncherState(mint: PublicKey): Promise<LauncherState> {
    const [launcherState] = PublicKey.findProgramAddressSync(
      [Buffer.from('launcher'), mint.toBuffer()],
      PROGRAM_ID
    );

    try {
      const account = await (this.program.account as any).launcherState.fetch(launcherState);
      return account as LauncherState;
    } catch (error) {
      console.error('Error fetching launcher state:', error);
      throw new Error('Failed to fetch launcher state');
    }
  }

  /**
   * Calculate token amount for given SOL amount
   */
  async calculateTokenAmount(mint: PublicKey, solAmount: number): Promise<number> {
    const state = await this.getLauncherState(mint);
    return Math.floor((solAmount * Math.pow(10, state.tokenDecimals)) / state.currentPrice.toNumber());
  }

  /**
   * Calculate SOL amount for given token amount
   */
  async calculateSolAmount(mint: PublicKey, tokenAmount: number): Promise<number> {
    const state = await this.getLauncherState(mint);
    // Apply 10% slippage for selling (same as in the program)
    const fullAmount = (tokenAmount * state.currentPrice.toNumber()) / Math.pow(10, state.tokenDecimals);
    return Math.floor(fullAmount * 0.9);
  }
}
