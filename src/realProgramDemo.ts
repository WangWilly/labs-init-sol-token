import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { TokenLauncherClient, TokenLaunchConfig } from './tokenLauncherClient';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

async function main() {
  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load or create a keypair (in production, use environment variables)
  const authority = Keypair.generate();
  console.log('🔑 Generated authority:', authority.publicKey.toBase58());
  
  // Create wallet and provider
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  
  // Request airdrop for testing
  console.log('💧 Requesting SOL airdrop...');
  try {
    const airdropSignature = await connection.requestAirdrop(
      authority.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSignature);
    console.log('✅ Airdrop successful');
  } catch (error) {
    console.log('⚠️ Airdrop failed, continuing with existing balance...');
  }
  
  // Initialize the token launcher client
  const client = new TokenLauncherClient(provider);
  
  try {
    console.log('\n🚀 Initializing token launcher...');
    
    // Configure the token launch
    const config: TokenLaunchConfig = {
      tokenName: 'Demo Launcher Token',
      tokenSymbol: 'DLT',
      tokenDecimals: 9,
      initialPrice: 1_000_000, // 0.001 SOL in lamports
      maxSupply: 1_000_000_000_000_000, // 1M tokens with 9 decimals
    };
    
    // Initialize the token launcher
    const { mint, launcherState, signature } = await client.initializeTokenLauncher(
      authority,
      config
    );
    
    console.log('✅ Token launcher initialized!');
    console.log(`   Mint: ${mint.toBase58()}`);
    console.log(`   Launcher State: ${launcherState.toBase58()}`);
    console.log(`   Transaction: ${signature}`);
    
    // Get launcher state
    console.log('\n📊 Fetching launcher state...');
    const state = await client.getLauncherState(mint);
    console.log('✅ Launcher state:', {
      tokenName: state.tokenName,
      tokenSymbol: state.tokenSymbol,
      currentPrice: state.currentPrice.toNumber(),
      totalMinted: state.totalMinted.toNumber(),
      maxSupply: state.maxSupply.toNumber(),
      solCollected: state.solCollected.toNumber(),
    });
    
    // Try buying tokens
    console.log('\n💰 Buying tokens...');
    const solAmountToBuy = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
    const buySignature = await client.buyTokens(authority, mint, solAmountToBuy);
    console.log(`✅ Tokens purchased! Transaction: ${buySignature}`);
    
    // Check updated state
    console.log('\n📊 Checking updated state after purchase...');
    const updatedState = await client.getLauncherState(mint);
    console.log('✅ Updated state:', {
      currentPrice: updatedState.currentPrice.toNumber(),
      totalMinted: updatedState.totalMinted.toNumber(),
      solCollected: updatedState.solCollected.toNumber(),
    });
    
    console.log('\n🎉 Demo completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the demo
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
