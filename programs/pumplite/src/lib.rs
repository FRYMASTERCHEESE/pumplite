use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SolTransfer};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, SetAuthority, Token, TokenAccount, TransferChecked},
};
pub mod math;

// Build identity only. The website deliberately has no configured deployed program.
declare_id!("7yCAWc9Tk8F5eTjn731ZZKxNypoBrbaXvFEm6c9z8ybY");
pub const TREASURY: Pubkey = pubkey!("BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct");
pub const DECIMALS: u8 = 6;

#[program]
pub mod pumplite {
    use super::*;
    pub fn create_market(
        ctx: Context<CreateMarket>,
        nonce: u64,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        require!(
            !name.trim().is_empty() && name.len() <= 32,
            LaunchError::Metadata
        );
        require!(
            !symbol.is_empty()
                && symbol.len() <= 10
                && symbol
                    .bytes()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()),
            LaunchError::Metadata
        );
        require!(
            uri.len() <= 200
                && (uri.is_empty() || uri.starts_with("https://") || uri.starts_with("ipfs://")),
            LaunchError::Metadata
        );
        let market = &mut ctx.accounts.market;
        market.version = 1;
        market.bump = ctx.bumps.market;
        market.creator = ctx.accounts.creator.key();
        market.mint = ctx.accounts.mint.key();
        market.nonce = nonce;
        market.native_reserve = 0;
        market.token_reserve = math::SUPPLY;
        market.volume = 0;
        market.name = name;
        market.symbol = symbol;
        market.uri = uri;

        let mint_key = ctx.accounts.mint.key();
        let bump = [market.bump];
        let seeds: &[&[u8]] = &[b"market", mint_key.as_ref(), &bump];
        let signer = &[seeds];
        token::mint_to(
            CpiContext::new(
                Token::id(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: market.to_account_info(),
                },
            )
            .with_signer(signer),
            math::SUPPLY,
        )?;
        token::set_authority(
            CpiContext::new(
                Token::id(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: market.to_account_info(),
                },
            )
            .with_signer(signer),
            token::spl_token::instruction::AuthorityType::MintTokens,
            None,
        )?;
        // Freeze authority was never set. No mint, freeze, withdrawal or market-edit instruction exists.
        emit!(MarketCreated {
            market: market.key(),
            mint: mint_key,
            creator: market.creator
        });
        Ok(())
    }

    pub fn buy(ctx: Context<Trade>, input: u64, minimum_output: u64, deadline: i64) -> Result<()> {
        check_trade(&ctx.accounts, minimum_output, deadline)?;
        let (output, fee) = math::buy(
            ctx.accounts.market.native_reserve,
            ctx.accounts.market.token_reserve,
            input,
        )
        .map_err(|_| error!(LaunchError::Quote))?;
        require!(output >= minimum_output, LaunchError::Slippage);
        let net = input.checked_sub(fee).ok_or(LaunchError::Overflow)?;
        system_program::transfer(
            CpiContext::new(
                System::id(),
                SolTransfer {
                    from: ctx.accounts.trader.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            fee,
        )?;
        system_program::transfer(
            CpiContext::new(
                System::id(),
                SolTransfer {
                    from: ctx.accounts.trader.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            net,
        )?;
        let mint_key = ctx.accounts.mint.key();
        let bump = [ctx.accounts.market.bump];
        let seeds: &[&[u8]] = &[b"market", mint_key.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.trader_tokens.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            output,
            DECIMALS,
        )?;
        let market = &mut ctx.accounts.market;
        market.native_reserve = market
            .native_reserve
            .checked_add(net)
            .ok_or(LaunchError::Overflow)?;
        market.token_reserve = market
            .token_reserve
            .checked_sub(output)
            .ok_or(LaunchError::Overflow)?;
        market.volume = market
            .volume
            .checked_add(input as u128)
            .ok_or(LaunchError::Overflow)?;
        emit!(TradeExecuted {
            market: market.key(),
            trader: ctx.accounts.trader.key(),
            buy: true,
            input,
            output,
            fee
        });
        Ok(())
    }

    pub fn sell(ctx: Context<Trade>, input: u64, minimum_output: u64, deadline: i64) -> Result<()> {
        check_trade(&ctx.accounts, minimum_output, deadline)?;
        let (gross, fee) = math::sell(
            ctx.accounts.market.native_reserve,
            ctx.accounts.market.token_reserve,
            input,
        )
        .map_err(|_| error!(LaunchError::Quote))?;
        let output = gross.checked_sub(fee).ok_or(LaunchError::Overflow)?;
        require!(output >= minimum_output, LaunchError::Slippage);
        // Return actual inventory. Never burn tokens on sale.
        token::transfer_checked(
            CpiContext::new(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.trader_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            input,
            DECIMALS,
        )?;
        pay(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            fee,
        )?;
        pay(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.trader.to_account_info(),
            output,
        )?;
        let market = &mut ctx.accounts.market;
        market.native_reserve = market
            .native_reserve
            .checked_sub(gross)
            .ok_or(LaunchError::Overflow)?;
        market.token_reserve = market
            .token_reserve
            .checked_add(input)
            .ok_or(LaunchError::Overflow)?;
        market.volume = market
            .volume
            .checked_add(gross as u128)
            .ok_or(LaunchError::Overflow)?;
        emit!(TradeExecuted {
            market: market.key(),
            trader: ctx.accounts.trader.key(),
            buy: false,
            input,
            output,
            fee
        });
        Ok(())
    }
}

fn check_trade(a: &Trade, minimum: u64, deadline: i64) -> Result<()> {
    require!(minimum > 0, LaunchError::Slippage);
    let now = Clock::get()?.unix_timestamp;
    require!(
        deadline >= now && deadline <= now.checked_add(300).ok_or(LaunchError::Overflow)?,
        LaunchError::Expired
    );
    require!(
        a.vault.amount >= a.market.token_reserve,
        LaunchError::Backing
    );
    let rent = Rent::get()?.minimum_balance(a.market.to_account_info().data_len());
    let needed = rent
        .checked_add(a.market.native_reserve)
        .ok_or(LaunchError::Overflow)?;
    require!(
        a.market.to_account_info().lamports() >= needed,
        LaunchError::Backing
    );
    require!(
        a.mint.mint_authority.is_none() && a.mint.freeze_authority.is_none(),
        LaunchError::Authority
    );
    Ok(())
}
fn pay(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    require_keys_neq!(from.key(), to.key(), LaunchError::Account);
    let debit = from
        .lamports()
        .checked_sub(amount)
        .ok_or(LaunchError::Backing)?;
    let credit = to
        .lamports()
        .checked_add(amount)
        .ok_or(LaunchError::Overflow)?;
    **from.try_borrow_mut_lamports()? = debit;
    **to.try_borrow_mut_lamports()? = credit;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer = creator, seeds = [b"mint", creator.key().as_ref(), &nonce.to_le_bytes()], bump,
        mint::decimals = DECIMALS, mint::authority = market)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = creator, seeds = [b"market", mint.key().as_ref()], bump, space = 8 + Market::INIT_SPACE)]
    pub market: Account<'info, Market>,
    #[account(init, payer = creator, associated_token::mint = mint, associated_token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, seeds = [b"market", mint.key().as_ref()], bump = market.bump, has_one = mint)]
    pub market: Account<'info, Market>,
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = trader)]
    pub trader_tokens: Account<'info, TokenAccount>,
    /// CHECK: fixed public treasury recipient; never creator-selected.
    #[account(mut, address = TREASURY)]
    pub treasury: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
}
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub version: u8,
    pub bump: u8,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub nonce: u64,
    pub native_reserve: u64,
    pub token_reserve: u64,
    pub volume: u128,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    #[max_len(200)]
    pub uri: String,
}
#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
}
#[event]
pub struct TradeExecuted {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub buy: bool,
    pub input: u64,
    pub output: u64,
    pub fee: u64,
}
#[error_code]
pub enum LaunchError {
    #[msg("Invalid metadata")]
    Metadata,
    #[msg("Quote unavailable: invalid amount, insufficient real liquidity, or overflow")]
    Quote,
    #[msg("Minimum output not met or zero")]
    Slippage,
    #[msg("Quote deadline expired or exceeds five minutes")]
    Expired,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Actual reserves do not back accounting")]
    Backing,
    #[msg("Unexpected mint or freeze authority")]
    Authority,
    #[msg("Invalid account")]
    Account,
}
