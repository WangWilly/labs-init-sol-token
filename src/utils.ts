import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

////////////////////////////////////////////////////////////////////////////////

/**
 * Load Keypair from environment variables
 * Supports both base58 and JSON array formats
 */
export function loadPayerKeypair(): Keypair {
  const base58Key = process.env.SOLANA_PRIVATE_KEY_BASE58;
  const jsonKey = process.env.SOLANA_PRIVATE_KEY_JSON;

  if (base58Key && base58Key !== 'your_base58_private_key_here') {
    try {
      console.log("🔑 Loading payer from base58 private key...");
      const secretKey = bs58.decode(base58Key);
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error("❌ Failed to decode base58 private key:", error);
      throw new Error("Invalid base58 private key format");
    }
  }

  if (jsonKey && jsonKey !== '[]') {
    try {
      console.log("🔑 Loading payer from JSON private key...");
      const secretKey = new Uint8Array(JSON.parse(jsonKey));
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error("❌ Failed to parse JSON private key:", error);
      throw new Error("Invalid JSON private key format");
    }
  }

  console.log("⚠️  No private key found in environment variables, generating new keypair...");
  console.log("💡 To use your own keypair, set SOLANA_PRIVATE_KEY_BASE58 in .env file");
  return Keypair.generate();
}

/**
 * Load Recipient Keypair from environment variables
 * Supports both base58 and JSON array formats
 */
export function loadRecipientKeypair(): Keypair {
  const base58Key = process.env.RECIPIENT_PRIVATE_KEY_BASE58;
  const jsonKey = process.env.RECIPIENT_PRIVATE_KEY_JSON;

  if (base58Key && base58Key !== 'recipient_base58_private_key_here') {
    try {
      console.log("🔑 Loading recipient from base58 private key...");
      const secretKey = bs58.decode(base58Key);
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error("❌ Failed to decode recipient base58 private key:", error);
      throw new Error("Invalid recipient base58 private key format");
    }
  }

  if (jsonKey && jsonKey !== '[]') {
    try {
      console.log("🔑 Loading recipient from JSON private key...");
      const secretKey = new Uint8Array(JSON.parse(jsonKey));
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error("❌ Failed to parse recipient JSON private key:", error);
      throw new Error("Invalid recipient JSON private key format");
    }
  }

  console.log("⚠️  No recipient private key found in environment variables, generating new keypair...");
  console.log("💡 To use your own recipient keypair, set RECIPIENT_PRIVATE_KEY_BASE58 in .env file");
  return Keypair.generate();
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfiguration() {
  return {
    endpoint: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    tokenDecimals: parseInt(process.env.TOKEN_DECIMALS || "6"),
    initialSupply: parseInt(process.env.INITIAL_SUPPLY || "1000000"),
    distributionBps: parseInt(process.env.DISTRIBUTION_BPS || "2500"),
    solAmount: parseFloat(process.env.SOL_AMOUNT || "2"),
    slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || "1"),
    // Token metadata properties
    tokenName: process.env.TOKEN_NAME || "Demo Token",
    tokenSymbol: process.env.TOKEN_SYMBOL || "DEMO",
    tokenImageUri: process.env.TOKEN_IMAGE_URI || "https://arweave.net/placeholder-image-uri",
  };
}
