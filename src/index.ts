import { Keypair, clusterApiUrl, PublicKey, Connection } from '@solana/web3.js';
import { SolanaTokenProgram } from './tokenProgram';
import { RaydiumAMMManager } from './raydiumAMM';
import { loadPayerKeypair, loadRecipientKeypair, loadConfiguration  } from './utils';
import * as dotenv from 'dotenv';

////////////////////////////////////////////////////////////////////////////////

async function main() {
  try {
    console.log('Starting Solana Token and Raydium AMM Demo...\n');
    const cfg = loadConfiguration();
    console.log(`Using configuration: ${JSON.stringify(cfg, null, 2)}\n`);

    // Initialize payer (you should replace this with your own keypair)
    const payer = loadPayerKeypair();
    if (!payer) {
      throw new Error('Failed to load payer keypair. Please check your environment variables.');
    }
    console.log(`Payer address: ${payer.publicKey.toString()}`);

    // Initialize connection to devnet
    const endpoint = cfg.endpoint
    const connection = new Connection(endpoint, 'confirmed');
    const tokenProgram = new SolanaTokenProgram(connection, payer);

    // Step 1: Create a fungible token
    console.log('=== STEP 1: Creating Fungible Token ===');
    const tokenMint = await tokenProgram.createToken(cfg.tokenDecimals, cfg.initialSupply);
    if (!tokenMint) {
      throw new Error('Token creation failed. Please check your configuration and network connection.');
    }
    console.log(`Token created with mint: ${tokenMint.toString()}\n`);

    // Step 2: Create new account and distribute tokens/SOL
    // Load or generate recipient account
    const newAccount = loadRecipientKeypair();
    console.log(
      `\n🎯 Recipient Account: ${newAccount.publicKey.toString()}`
    );
    console.log('=== STEP 2: Distributing Tokens and SOL ===');
    const distributionResult = await tokenProgram.distributeTokensAndSol(
      cfg.distributionBps,
      cfg.solAmount,
      newAccount.publicKey
    );

    console.log('Distribution completed:');
    console.log(`- New account: ${distributionResult.newAccountPubkey.toString()}`);
    console.log(`- ATA address: ${distributionResult.ataAddress.toString()}`);
    console.log(`- Tokens distributed: ${distributionResult.tokenAmount}`);
    console.log(`- SOL distributed: ${distributionResult.solAmount}\n`);

    // Check balances
    const balances = await tokenProgram.getAccountBalances(newAccount.publicKey, tokenMint);
    console.log(`New account balances:`);
    console.log(`- SOL: ${balances.solBalance}`);
    console.log(`- Tokens: ${balances.tokenBalance}\n`);

    // Step 3: Create Raydium AMM Pool
    console.log('=== STEP 3: Creating Raydium AMM Pool ===');
    const ammManager = new RaydiumAMMManager(tokenProgram.getConnection(), newAccount);
    
    // Use WSOL mint for the quote token (SOL)
    const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
    
    const marketId = await ammManager.createMarket(
      tokenMint,
      WSOL_MINT,
    );
    
    try {
      const poolResult = await ammManager.createAMMPool(
        tokenMint, // base token
        WSOL_MINT, // quote token (WSOL)
        distributionResult.tokenAmount,
        balances.solBalance,
        cfg.tokenDecimals, // base token decimals
        9, // WSOL decimals
        marketId // OpenBook market ID (required for SDK V1)
      );

      console.log(`AMM Pool created successfully!`);
      console.log(`Transaction: ${poolResult.txids.join(', ')}`);
      console.log(`Pool ID: ${poolResult.poolKeys.id.toString()}\n`);

      // Step 4: Perform a swap
      console.log('=== STEP 4: Performing Token Swap ===');
      const swapAmount = distributionResult.tokenAmount * 0.1; // Swap 10% of remaining tokens
      
      const swapRes = await ammManager.swapTokens(
        poolResult.poolKeys,
        tokenMint, // Input token
        WSOL_MINT, // Output token (SOL)
        swapAmount,
        cfg.slippageTolerance // Slippage tolerance in percentage
      );

      console.log(`Swap completed successfully!`);
      console.log(`Transaction: ${swapRes.txids.join(', ')}`);
      console.log(`Swapped ${swapAmount} tokens for SOL.\n`);
      console.log(`Swapped ${swapRes.outputAmount} tokens for SOL.\n`);

      // Check final balances
      const finalBalances = await tokenProgram.getAccountBalances(newAccount.publicKey, tokenMint);
      console.log('=== FINAL BALANCES ===');
      console.log(`New account final balances:`);
      console.log(`- SOL: ${finalBalances.solBalance}`);
      console.log(`- Tokens: ${finalBalances.tokenBalance}`);

    } catch (error) {
      console.error('Error with AMM operations:', error);
      console.log('Note: AMM pool creation on devnet requires additional setup and may fail in this demo.');
      console.log('The token creation and distribution steps should work correctly.');
    }

  } catch (error) {
    console.error('Error in main execution:', error);
  }
}

// Export for testing
export {
  SolanaTokenProgram,
  RaydiumAMMManager,
  main,
};

// Run the main function if this file is executed directly
if (require.main === module) {
  dotenv.config();
  main().catch(console.error);
}
