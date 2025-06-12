use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("GQwwtMLV9P2ywbAqA9dAKxZjKT6NzMrwfqqFVsaCvGEF");

#[program]
pub mod token_launcher {
    use super::*;

    /// Initialize the token launcher program
    /// Creates a mint with the program as the mint authority
    pub fn initialize_token_launcher(
        ctx: Context<InitializeTokenLauncher>,
        token_name: String,
        token_symbol: String,
        token_decimals: u8,
        initial_price: u64, // Price in lamports per token
        max_supply: u64,
    ) -> Result<()> {
        let launcher_state = &mut ctx.accounts.launcher_state;
        
        launcher_state.authority = ctx.accounts.authority.key();
        launcher_state.mint = ctx.accounts.mint.key();
        launcher_state.token_name = token_name.clone();
        launcher_state.token_symbol = token_symbol.clone();
        launcher_state.token_decimals = token_decimals;
        launcher_state.current_price = initial_price;
        launcher_state.max_supply = max_supply;
        launcher_state.total_minted = 0;
        launcher_state.sol_collected = 0;
        launcher_state.bump = ctx.bumps.launcher_state;
        launcher_state.vault_bump = ctx.bumps.sol_vault;

        msg!(
            "Token launcher initialized: {} ({}), Price: {} lamports per token",
            token_name,
            token_symbol,
            initial_price
        );

        Ok(())
    }

    /// Buy tokens with SOL
    /// The program mints tokens directly to the buyer
    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        sol_amount: u64,
    ) -> Result<()> {
        // Read values before mutable borrow
        let current_price = ctx.accounts.launcher_state.current_price;
        let token_decimals = ctx.accounts.launcher_state.token_decimals;
        let max_supply = ctx.accounts.launcher_state.max_supply;
        let total_minted = ctx.accounts.launcher_state.total_minted;
        let mint_key = ctx.accounts.mint.key();
        let launcher_bump = ctx.accounts.launcher_state.bump;
        
        // Calculate token amount based on current price
        let token_amount = sol_amount
            .checked_div(current_price)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(10_u64.pow(token_decimals as u32))
            .ok_or(ErrorCode::MathOverflow)?;

        // Check if minting would exceed max supply
        require!(
            total_minted
                .checked_add(token_amount)
                .ok_or(ErrorCode::MathOverflow)?
                <= max_supply,
            ErrorCode::MaxSupplyExceeded
        );

        // Transfer SOL from buyer to program vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, sol_amount)?;

        // Mint tokens to buyer's token account
        let seeds = &[
            b"launcher".as_ref(),
            mint_key.as_ref(),
            &[launcher_bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.launcher_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::mint_to(cpi_ctx, token_amount)?;

        // Now we can mutably borrow for updates
        let launcher_state = &mut ctx.accounts.launcher_state;
        
        // Update state
        launcher_state.total_minted = launcher_state.total_minted
            .checked_add(token_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        launcher_state.sol_collected = launcher_state.sol_collected
            .checked_add(sol_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        // Implement price discovery - price increases as more tokens are sold
        launcher_state.update_price()?;

        msg!(
            "Tokens purchased: {} tokens for {} SOL, New price: {} lamports per token",
            token_amount,
            sol_amount,
            launcher_state.current_price
        );

        Ok(())
    }

    /// Sell tokens back to the program for SOL
    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        token_amount: u64,
    ) -> Result<()> {
        let launcher_state = &mut ctx.accounts.launcher_state;
        
        // Calculate SOL amount based on current price (with slippage)
        let sol_amount = token_amount
            .checked_div(10_u64.pow(launcher_state.token_decimals as u32))
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(launcher_state.current_price)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(90) // 90% of current price (10% slippage)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::MathOverflow)?;

        // Check if program has enough SOL
        require!(
            ctx.accounts.sol_vault.lamports() >= sol_amount,
            ErrorCode::InsufficientSolBalance
        );

        // Burn tokens from seller's account
        let cpi_accounts = anchor_spl::token::Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.seller_token_account.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        anchor_spl::token::burn(cpi_ctx, token_amount)?;

        // Transfer SOL from vault to seller
        let seeds = &[
            b"sol_vault".as_ref(),
            launcher_state.mint.as_ref(),
            &[launcher_state.vault_bump],
        ];
        let _signer = &[&seeds[..]];

        **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= sol_amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += sol_amount;

        // Update state
        launcher_state.total_minted = launcher_state.total_minted
            .checked_sub(token_amount)
            .ok_or(ErrorCode::MathOverflow)?;
        launcher_state.sol_collected = launcher_state.sol_collected
            .checked_sub(sol_amount)
            .ok_or(ErrorCode::MathOverflow)?;

        // Update price
        launcher_state.update_price()?;

        msg!(
            "Tokens sold: {} tokens for {} SOL, New price: {} lamports per token",
            token_amount,
            sol_amount,
            launcher_state.current_price
        );

        Ok(())
    }

    /// Withdraw collected SOL (only authority)
    pub fn withdraw_sol(
        ctx: Context<WithdrawSol>,
        amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.launcher_state.authority,
            ErrorCode::Unauthorized
        );

        let seeds = &[
            b"sol_vault".as_ref(),
            ctx.accounts.launcher_state.mint.as_ref(),
            &[ctx.accounts.launcher_state.vault_bump],
        ];
        let _signer = &[&seeds[..]];

        **ctx.accounts.sol_vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;

        msg!("Withdrew {} SOL", amount);

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_name: String, token_symbol: String)]
pub struct InitializeTokenLauncher<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = LauncherState::LEN,
        seeds = [b"launcher", mint.key().as_ref()],
        bump
    )]
    pub launcher_state: Account<'info, LauncherState>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = launcher_state,
        mint::freeze_authority = launcher_state,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: This is a PDA that will hold SOL
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"sol_vault", mint.key().as_ref()],
        bump
    )]
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(sol_amount: u64)]
pub struct BuyTokens<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"launcher", mint.key().as_ref()],
        bump = launcher_state.bump
    )]
    pub launcher_state: Account<'info, LauncherState>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA that will receive SOL
    #[account(
        mut,
        seeds = [b"sol_vault", mint.key().as_ref()],
        bump = launcher_state.vault_bump
    )]
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(token_amount: u64)]
pub struct SellTokens<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"launcher", mint.key().as_ref()],
        bump = launcher_state.bump
    )]
    pub launcher_state: Account<'info, LauncherState>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA that will send SOL
    #[account(
        mut,
        seeds = [b"sol_vault", mint.key().as_ref()],
        bump = launcher_state.vault_bump
    )]
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"launcher", mint.key().as_ref()],
        bump = launcher_state.bump
    )]
    pub launcher_state: Account<'info, LauncherState>,

    pub mint: Account<'info, Mint>,

    /// CHECK: This is a PDA that will send SOL
    #[account(
        mut,
        seeds = [b"sol_vault", mint.key().as_ref()],
        bump = launcher_state.vault_bump
    )]
    pub sol_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct LauncherState {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub token_decimals: u8,
    pub current_price: u64,
    pub max_supply: u64,
    pub total_minted: u64,
    pub sol_collected: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl LauncherState {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // mint
        4 + 50 + // token_name (max 50 chars)
        4 + 10 + // token_symbol (max 10 chars)
        1 + // token_decimals
        8 + // current_price
        8 + // max_supply
        8 + // total_minted
        8 + // sol_collected
        1 + // bump
        1; // vault_bump

    /// Update price based on supply and demand
    pub fn update_price(&mut self) -> Result<()> {
        // Simple bonding curve: price increases as more tokens are minted
        let supply_ratio = (self.total_minted * 100) / self.max_supply;
        
        // Base price increases by 1% for every 1% of supply minted
        let price_multiplier = 100 + supply_ratio;
        let base_price = 1_000_000; // 0.001 SOL base price
        
        self.current_price = (base_price * price_multiplier) / 100;
        
        Ok(())
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Mathematical operation resulted in overflow")]
    MathOverflow,
    #[msg("Maximum token supply would be exceeded")]
    MaxSupplyExceeded,
    #[msg("Insufficient SOL balance in vault")]
    InsufficientSolBalance,
    #[msg("Unauthorized operation")]
    Unauthorized,
}
