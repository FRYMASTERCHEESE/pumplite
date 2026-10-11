use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SolTransfer};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, SetAuthority, Token, TokenAccount, TransferChecked},
};
pub mod math;
pub mod mayhem;
pub mod metadata;
use mayhem::Mayhem;

// UNASSIGNED BUILD ID: not a mainnet deployment. Select a new public program ID and rebuild before approval.
declare_id!("5squ4au25LQGEWrFhQejekDQAr9pjiXwscvFCoQFcAkw");
pub const TREASURY: Pubkey = pubkey!("BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct");
pub const DECIMALS: u8 = 6;

#[program]
pub mod pumplite_v6 {
    use super::*;
    pub fn create_market(
        ctx: Context<CreateMarket>,
        nonce: u64,
        name: String,
        symbol: String,
        uri: String,
        launch_mode: u8,
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
        market.mayhem = Mayhem::new(launch_mode, Clock::get()?.unix_timestamp)?;
        market.version = 6;
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
        let seeds: &[&[u8]] = &[b"market-v6", mint_key.as_ref(), &bump];
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
            math::SUPPLY
                .checked_add(market.mayhem.inventory)
                .ok_or(LaunchError::Overflow)?,
        )?;
        metadata::create(
            ctx.accounts.metadata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            market.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.metadata_program.to_account_info(),
            &market.name,
            &market.symbol,
            &market.uri,
            seeds,
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
        let active = ctx.accounts.market.mayhem.active(
            Clock::get()?.unix_timestamp,
            ctx.accounts.market.native_reserve,
        );
        let fee = math::fee(input).map_err(|_| error!(LaunchError::Quote))?;
        let support = math::support(input, active).map_err(|_| error!(LaunchError::Quote))?;
        let priced_input = input
            .checked_sub(fee)
            .and_then(|v| v.checked_sub(support))
            .ok_or(LaunchError::Quote)?;
        let output = math::raw_buy(
            ctx.accounts.market.native_reserve,
            ctx.accounts.market.token_reserve,
            priced_input,
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
        let seeds: &[&[u8]] = &[b"market-v6", mint_key.as_ref(), &bump];
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
        market.total_market_support = market
            .total_market_support
            .checked_add(support)
            .ok_or(LaunchError::Overflow)?;
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
            fee,
            support
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
        let support = math::support(
            gross,
            ctx.accounts.market.mayhem.active(
                Clock::get()?.unix_timestamp,
                ctx.accounts.market.native_reserve,
            ),
        )
        .map_err(|_| error!(LaunchError::Quote))?;
        let output = gross
            .checked_sub(fee)
            .and_then(|v| v.checked_sub(support))
            .ok_or(LaunchError::Overflow)?;
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
        market.total_market_support = market
            .total_market_support
            .checked_add(support)
            .ok_or(LaunchError::Overflow)?;
        market.native_reserve = market
            .native_reserve
            .checked_sub(gross - support)
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
            fee,
            support
        });
        Ok(())
    }
    pub fn fund_mayhem(ctx: Context<FundMarket>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            amount > 0
                && ctx.accounts.market.mayhem.mode != 0
                && !ctx.accounts.market.mayhem.ended(now),
            LaunchError::MayhemState
        );
        let next = ctx
            .accounts
            .market
            .mayhem
            .native_bank
            .checked_add(amount)
            .ok_or(LaunchError::Overflow)?;
        deposit(&ctx.accounts, amount)?;
        ctx.accounts.market.mayhem.native_bank = next;
        Ok(())
    }
    pub fn support_market(ctx: Context<FundMarket>, amount: u64) -> Result<()> {
        require!(amount > 0, LaunchError::Quote);
        let next = ctx
            .accounts
            .market
            .native_reserve
            .checked_add(amount)
            .ok_or(LaunchError::Overflow)?;
        deposit(&ctx.accounts, amount)?;
        ctx.accounts.market.native_reserve = next;
        Ok(())
    }
    pub fn request_mayhem(ctx: Context<CreatorMarket>) -> Result<()> {
        ctx.accounts
            .market
            .mayhem
            .request(Clock::get()?.unix_timestamp)
    }
    pub fn commit_mayhem(ctx: Context<ControllerMarket>, commitment: [u8; 32]) -> Result<()> {
        let clock = Clock::get()?;
        let native = ctx.accounts.market.native_reserve;
        ctx.accounts
            .market
            .mayhem
            .commit(commitment, clock.unix_timestamp, clock.slot, native)
    }
    pub fn expire_mayhem(ctx: Context<PublicMarket>) -> Result<()> {
        let clock = Clock::get()?;
        ctx.accounts
            .market
            .mayhem
            .expire(clock.unix_timestamp, clock.slot)
    }
    pub fn reveal_mayhem(ctx: Context<RevealMayhem>, secret: [u8; 32]) -> Result<()> {
        check_backing(
            &ctx.accounts.market,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
        )?;
        let clock = Clock::get()?;
        let hash = future_slot_hash(
            &ctx.accounts.slot_hashes.to_account_info(),
            ctx.accounts.market.mayhem.target_slot,
        )?;
        let market = &mut ctx.accounts.market;
        let address = market.key().to_bytes();
        let native = market.native_reserve;
        let tokens = market.token_reserve;
        let result = market.mayhem.reveal(
            secret,
            hash,
            address,
            clock.unix_timestamp,
            clock.slot,
            native,
            tokens,
        )?;
        market.native_reserve = result.native_reserve;
        market.token_reserve = result.token_reserve;
        emit!(MayhemTrade {
            market: market.key(),
            buy: result.is_buy,
            native: result.native,
            tokens: result.tokens,
            randomness: result.randomness
        });
        Ok(())
    }
    pub fn finalize_mayhem(ctx: Context<FinalizeMayhem>) -> Result<()> {
        check_backing(
            &ctx.accounts.market,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
        )?;
        let market = &mut ctx.accounts.market;
        require!(
            market.mayhem.mode != 0
                && market.mayhem.ended(Clock::get()?.unix_timestamp)
                && !market.mayhem.finalized,
            LaunchError::MayhemState
        );
        let next = market
            .native_reserve
            .checked_add(market.mayhem.native_bank)
            .ok_or(LaunchError::Overflow)?;
        let mint_key = ctx.accounts.mint.key();
        let bump = [market.bump];
        let seeds: &[&[u8]] = &[b"market-v6", mint_key.as_ref(), &bump];
        if market.mayhem.inventory > 0 {
            token::burn(
                CpiContext::new(
                    Token::id(),
                    token::Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.vault.to_account_info(),
                        authority: market.to_account_info(),
                    },
                )
                .with_signer(&[seeds]),
                market.mayhem.inventory,
            )?;
        }
        market.native_reserve = next;
        market.mayhem.native_bank = 0;
        market.mayhem.inventory = 0;
        market.mayhem.finalized = true;
        market.mayhem.commitment = [0; 32];
        market.mayhem.target_slot = 0;
        market.mayhem.pending_request = false;
        Ok(())
    }
}

fn deposit(a: &FundMarket, amount: u64) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            System::id(),
            SolTransfer {
                from: a.supporter.to_account_info(),
                to: a.market.to_account_info(),
            },
        ),
        amount,
    )
}
fn future_slot_hash(account: &AccountInfo, target: u64) -> Result<[u8; 32]> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, LaunchError::Reveal);
    let count = u64::from_le_bytes(
        data[..8]
            .try_into()
            .map_err(|_| error!(LaunchError::Reveal))?,
    ) as usize;
    require!(
        count <= 512 && data.len() >= 8 + count * 40,
        LaunchError::Reveal
    );
    for entry in data[8..8 + count * 40].chunks_exact(40) {
        let slot = u64::from_le_bytes(
            entry[..8]
                .try_into()
                .map_err(|_| error!(LaunchError::Reveal))?,
        );
        if slot == target {
            return entry[8..40]
                .try_into()
                .map_err(|_| error!(LaunchError::Reveal));
        }
    }
    err!(LaunchError::Reveal)
}
fn check_trade(a: &Trade, minimum: u64, deadline: i64) -> Result<()> {
    require!(
        a.market.version == 6 && a.mint.decimals == DECIMALS,
        LaunchError::Account
    );
    require!(minimum > 0, LaunchError::Slippage);
    let now = Clock::get()?.unix_timestamp;
    require!(
        deadline >= now && deadline <= now.checked_add(300).ok_or(LaunchError::Overflow)?,
        LaunchError::Expired
    );
    check_backing(&a.market, &a.mint, &a.vault)
}
fn check_backing(
    market: &Account<Market>,
    mint: &Account<Mint>,
    vault: &Account<TokenAccount>,
) -> Result<()> {
    require!(
        market.version == 6 && mint.decimals == DECIMALS,
        LaunchError::Account
    );
    require!(
        vault.amount
            >= market
                .token_reserve
                .checked_add(market.mayhem.inventory)
                .ok_or(LaunchError::Overflow)?,
        LaunchError::Backing
    );
    let rent = Rent::get()?.minimum_balance(market.to_account_info().data_len());
    let needed = rent
        .checked_add(market.native_reserve)
        .and_then(|v| v.checked_add(market.mayhem.native_bank))
        .ok_or(LaunchError::Overflow)?;
    require!(
        market.to_account_info().lamports() >= needed,
        LaunchError::Backing
    );
    require!(
        mint.mint_authority.is_none() && mint.freeze_authority.is_none(),
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
    #[account(init, payer = creator, seeds = [b"mint-v6", creator.key().as_ref(), &nonce.to_le_bytes()], bump,
        mint::decimals = DECIMALS, mint::authority = market)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = creator, seeds = [b"market-v6", mint.key().as_ref()], bump, space = 8 + Market::INIT_SPACE)]
    pub market: Account<'info, Market>,
    #[account(init, payer = creator, associated_token::mint = mint, associated_token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,
    /// CHECK: PDA belongs to the fixed Metaplex program, which initializes and validates its data.
    #[account(mut, seeds = [b"metadata", metadata::ID.as_ref(), mint.key().as_ref()], bump, seeds::program = metadata::ID)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: only the fixed executable metadata program is invoked.
    #[account(address = metadata::ID, executable)]
    pub metadata_program: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, seeds = [b"market-v6", mint.key().as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account, has_one = mint)]
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
#[derive(Accounts)]
pub struct FundMarket<'info> {
    #[account(mut)]
    pub supporter: Signer<'info>,
    #[account(mut, seeds = [b"market-v6", market.mint.as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CreatorMarket<'info> {
    pub creator: Signer<'info>,
    #[account(mut, seeds = [b"market-v6", market.mint.as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account, has_one = creator)]
    pub market: Account<'info, Market>,
}
#[derive(Accounts)]
pub struct ControllerMarket<'info> {
    #[account(address = TREASURY)]
    pub controller: Signer<'info>,
    #[account(mut, seeds = [b"market-v6", market.mint.as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account)]
    pub market: Account<'info, Market>,
}
#[derive(Accounts)]
pub struct PublicMarket<'info> {
    #[account(mut, seeds = [b"market-v6", market.mint.as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account)]
    pub market: Account<'info, Market>,
}
#[derive(Accounts)]
pub struct RevealMayhem<'info> {
    #[account(address = TREASURY)]
    pub controller: Signer<'info>,
    #[account(mut, seeds = [b"market-v6", mint.key().as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account, has_one = mint)]
    pub market: Account<'info, Market>,
    pub mint: Account<'info, Mint>,
    #[account(associated_token::mint = mint, associated_token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: fixed runtime SlotHashes sysvar; parser reads only the committed future slot.
    #[account(address = pubkey!("SysvarS1otHashes111111111111111111111111111"), owner = pubkey!("Sysvar1111111111111111111111111111111111111"))]
    pub slot_hashes: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct FinalizeMayhem<'info> {
    #[account(mut, seeds = [b"market-v6", mint.key().as_ref()], bump = market.bump, constraint = market.version == 6 @ LaunchError::Account, has_one = mint)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = market)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[event]
pub struct MayhemTrade {
    pub market: Pubkey,
    pub buy: bool,
    pub native: u64,
    pub tokens: u64,
    pub randomness: [u8; 32],
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
    pub total_market_support: u64,
    pub mayhem: Mayhem,
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
    pub support: u64,
}
#[error_code]
pub enum LaunchError {
    #[msg("Invalid immutable launch mode")]
    Mode,
    #[msg("Mayhem is inactive, paused, ended or awaiting interval")]
    MayhemState,
    #[msg("Missing, pending or mismatched commitment")]
    Commitment,
    #[msg("Reveal slot is too early, expired or unavailable")]
    Reveal,
    #[msg("Creator must request one Manual agent trade")]
    MayhemRequest,
    #[msg("Insufficient segregated Mayhem funding or inventory")]
    MayhemFunding,
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
