# Solana Token Creation & Raydium AMM Integration

A comprehensive TypeScript program for Solana devnet that creates SPL tokens and integrates with Raydium AMM for OpenBook market creation, liquidity pool management, and token swapping.

## 🚀 Features

### Core Token Operations
- **SPL Token Creation**: Create fungible tokens with custom decimals and initial supply
- **Token Distribution**: BPS-based percentage distribution with automatic ATA creation

### Raydium AMM Integration
- **OpenBook Market Creation**: Automated market creation using Raydium SDK v1
- **AMM Pool Creation**: Liquidity pool creation with configurable parameters
- **Token Swapping**: High-performance swaps with slippage protection
- **Liquidity Management**: Add/remove liquidity from existing pools
- **Price Discovery**: Real-time price fetching from AMM pools

## 📋 Prerequisites

- **Node.js**: v16 or higher
- **Funded Wallet**: Devnet SOL for transaction fees
- **TypeScript**: Development environment

## ⚙️ Configuration

### Environment Setup

Copy `.env.example` to `.env` and configure:

```env
# Payer wallet (base58 private key)
SOLANA_PRIVATE_KEY_BASE58=your_base58_private_key_here

# Recipient wallet
RECIPIENT_PRIVATE_KEY_BASE58=recipient_base58_private_key_here

# Network configuration
SOLANA_RPC_URL=https://api.devnet.solana.com

# Token parameters
TOKEN_DECIMALS=9
INITIAL_SUPPLY=1000000
DISTRIBUTION_BPS=2500  # 25%
SOL_AMOUNT=0.5

# AMM settings
SLIPPAGE_TOLERANCE=1  # 1%
```

### Getting Devnet SOL

1. Visit [Solana Faucet](https://faucet.solana.com/)
2. Request devnet SOL for your wallet addresses
3. Ensure sufficient balance for transaction fees

## 🏃‍♂️ Usage

### Quick Start

```bash
# Run the complete demo workflow
npm run dev

# Or run compiled version
npm start
```

### Programmatic Usage

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { SolanaTokenProgram, RaydiumAMMManager } from './src';

// Initialize connection and wallet
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const payer = Keypair.fromSecretKey(yourSecretKey);

// Create token program instance
const tokenProgram = new SolanaTokenProgram(connection, payer);

// Step 1: Create a new token
const tokenMint = await tokenProgram.createToken(
  9,        // decimals
  1000000   // initial supply
);

// Step 2: Distribute tokens and SOL
const recipient = Keypair.generate();
const distribution = await tokenProgram.distributeTokensAndSol(
  2500,                    // 25% in BPS
  1.0,                     // 1 SOL
  recipient.publicKey
);

// Step 3: Create AMM operations
const ammManager = new RaydiumAMMManager(connection, payer);
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Create OpenBook market
const marketId = await ammManager.createMarket(tokenMint, WSOL_MINT);

// Create AMM pool
const poolResult = await ammManager.createAMMPool(
  tokenMint,     // base token
  WSOL_MINT,     // quote token (SOL)
  1000,          // base amount
  1,             // quote amount
  9,             // base decimals
  9,             // quote decimals
  marketId       // market ID
);

// Perform token swap
const swapResult = await ammManager.swapTokens(
  poolResult.poolKeys,
  tokenMint,     // input token
  WSOL_MINT,     // output token
  100,           // input amount
  1              // 1% slippage
);
```

## 🔧 Project Structure

```
labs-init-sol-token/
├── src/
│   ├── index.ts           # Main demo workflow
│   ├── tokenProgram.ts    # SPL token operations
│   ├── raydiumAMM.ts      # Raydium AMM integration
│   └── utils.ts           # Utility functions
├── dist/                  # Compiled JavaScript
├── .env.example           # Environment template
├── package.json           # Dependencies and scripts
└── tsconfig.json          # TypeScript configuration
```

## ⚠️ Important Notes

### Network Considerations
- **Devnet Only**: This implementation is designed for devnet testing
- **RPC Limits**: Use custom RPC endpoints for better reliability
- **Transaction Fees**: Ensure sufficient SOL for all operations

### AMM Limitations
- **Market Dependency**: AMM pools require valid OpenBook markets
- **Liquidity Requirements**: Minimum token and SOL amounts needed
- **Slippage Impact**: High slippage on low liquidity pools

### Security Best Practices
- **Private Keys**: Never commit private keys to version control
- **Environment Variables**: Use `.env` files for sensitive data
- **Validation**: Always validate inputs and transaction results
- **Testing**: Thoroughly test on devnet before mainnet deployment

## 🐛 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **Insufficient SOL** | Fund wallets with devnet SOL from faucet |
| **Token Account Creation** | ATAs are created automatically but require SOL |
| **Pool Creation Failures** | Ensure market exists and sufficient liquidity |
| **RPC Timeouts** | Use reliable RPC endpoints or retry logic |
| **Transaction Failures** | Check account balances and network congestion |

### Debug Mode

Enable detailed logging by setting:
```env
LOG_LEVEL=debug
```

## 📦 Dependencies

### Core Dependencies
- `@solana/web3.js`: Solana JavaScript SDK
- `@solana/spl-token`: SPL Token SDK
- `@raydium-io/raydium-sdk`: Raydium AMM integration
- `bn.js`: Big number arithmetic
- `bs58`: Base58 encoding/decoding

### Development Dependencies
- `typescript`: TypeScript compiler
- `ts-node`: TypeScript execution
- `@types/node`: Node.js type definitions

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Solana Documentation**: [https://docs.solana.com/](https://docs.solana.com/)
- **Raydium SDK**: [https://github.com/raydium-io/raydium-sdk](https://github.com/raydium-io/raydium-sdk)
- **Issues**: Report bugs and feature requests via GitHub Issues

## 🔗 Related Resources

- [SPL Token Program](https://spl.solana.com/token)
- [Raydium Protocol](https://raydium.io/)
- [OpenBook DEX](https://www.openbook-solana.com/)
- [Solana Cookbook](https://solanacookbook.com/)
