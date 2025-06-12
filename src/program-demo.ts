import { Connection } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { TokenLaunchConfig, TokenLauncherClient } from './tokenLauncherClient';
import { loadPayerKeypair, loadConfiguration } from './utils';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Example demonstrating program-controlled token launcher
 * The program owns the mint authority and handles price discovery
 */
async function demonstrateTokenLauncher() {
  try {
    console.log('🚀 Demonstrating Program-Controlled Token Launcher...\n');

    // Setup
    const cfg = loadConfiguration();
    const connection = new Connection(cfg.endpoint, 'confirmed');
    const payer = loadPayerKeypair();
    
    console.log(`💰 Authority: ${payer.publicKey.toString()}`);
    
    // Create wallet wrapper for Anchor
    const wallet = new Wallet(payer);
    const provider = new AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
      });
    
    // Initialize token launcher client
    const launcher = new TokenLauncherClient(provider);

    // Step 1: Initialize Token Launcher
    console.log('📝 Step 1: Initializing Token Launcher...');
    const authority = payer; // Use payer as authority for simplicity
    const config: TokenLaunchConfig = {
      tokenName: 'Demo Launcher Token',
      tokenSymbol: 'DLT',
      tokenDecimals: 9,
      initialPrice: cfg.initialTokenPrice,
      maxSupply: cfg.maxTokenSupply,
    };
    const initResult = await launcher.initializeTokenLauncher(
      authority, config
    );
    
    console.log(`✅ Token launcher initialized!`);
    console.log(`🪙 Mint: ${initResult.mint.toString()}`);
    console.log(`📋 Launcher State: ${initResult.launcherState.toString()}`);

    const mint = initResult.mint;

    // Step 2: Buy tokens (simulating user purchases)
    console.log('💰 Step 2: Buying tokens...');
    
    // First purchase
    const buyer = payer; // Use authority as buyer for demo
    await launcher.buyTokens(buyer, mint, 0.1); // Buy with 0.1 SOL

    // Second purchase (price should increase due to bonding curve)
    await launcher.buyTokens(buyer, mint, 0.2); // Buy with 0.2 SOL

    // Step 3: Check launcher state
    console.log('\n📊 Step 3: Checking launcher state...');
    const state = await launcher.getLauncherState(mint);
    if (state) {
      console.log(`Token Name: ${state.tokenName}`);
      console.log(`Token Symbol: ${state.tokenSymbol}`);
      console.log(`Current Price: ${state.currentPrice.toNumber() / 1e9} SOL per token`);
      console.log(`Total Minted: ${state.totalMinted.toNumber() / Math.pow(10, state.tokenDecimals)} tokens`);
      console.log(`SOL Collected: ${state.solCollected.toNumber() / 1e9} SOL`);
      console.log(`Max Supply: ${state.maxSupply.toNumber() / Math.pow(10, state.tokenDecimals)} tokens`);
    }

    // Step 5: Sell some tokens back
    console.log('\n💸 Step 5: Selling tokens back...');
    try {
      await launcher.sellTokens(buyer, mint, 50); // Sell 50 tokens
    } catch (error) {
      console.log(`Note: Selling might fail if you don't have tokens yet: ${error}`);
    }

    // Step 6: Authority operations (withdraw SOL)
    console.log('\n🏦 Step 6: Authority operations...');
    try {
      await launcher.withdrawSol(payer, mint, 0.05); // Withdraw 0.05 SOL
      console.log('Authority successfully withdrew SOL');
    } catch (error) {
      console.log(`Withdrawal failed: ${error}`);
    }

    // Final state
    console.log('\n📊 Final State:');
    const finalState = await launcher.getLauncherState(mint);
    if (finalState) {
      console.log(`Final Price: ${finalState.currentPrice.toNumber() / 1e9} SOL per token`);
      console.log(`Total Minted: ${finalState.totalMinted.toNumber() / Math.pow(10, finalState.tokenDecimals)} tokens`);
      console.log(`SOL Collected: ${finalState.solCollected.toNumber() / 1e9} SOL`);
    }

    console.log('\n🎉 Token launcher demonstration completed!');
    console.log('\n💡 Key Benefits:');
    console.log('✅ Program owns mint authority (not user wallet)');
    console.log('✅ Automatic price discovery through bonding curve');
    console.log('✅ Built-in liquidity through buy/sell mechanism');
    console.log('✅ Revenue collection for token creators');
    console.log('✅ Controlled token supply and distribution');

  } catch (error) {
    console.error('❌ Error in token launcher demonstration:', error);
  }
}

// Export functions for use
export {
  demonstrateTokenLauncher,
};

if (require.main === module) {
  demonstrateTokenLauncher().catch(console.error);
}
