use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Burn, Mint, MintTo, SetAuthority, TokenAccount, TokenInterface, TransferChecked},
};
use mpl_token_metadata::{
    instructions::CreateMetadataAccountV3CpiBuilder,
    types::DataV2,
};

// This is a placeholder program id. Generate the real program keypair with
// `anchor keys list` / `anchor build`, then run `anchor keys sync` before deployment.
declare_id!("7yCAWc9Tk8F5eTjn731ZZKxNypoBrbaXvFEm6c9z8ybY");

pub const TOTAL_FEE_BPS: u64 = 25;
pub const CREATOR_FEE_BPS: u64 = 10;
pub const TREASURY_FEE_BPS: u64 = 5;
pub const RESERVE_FEE_BPS: u64 = 5;
pub const REFERRAL_FEE_BPS: u64 = 5;
pub const BPS_DENOM: u64 = 10_000;
pub const DEFAULT_VIRTUAL_SOL: u64 = 30_000_000_000;
pub const DEFAULT_VIRTUAL_TOKENS: u128 = 1_073_000_000_000_000;
pub const MAX_NAME: usize = 32;
pub const MAX_SYMBOL: usize = 10;
pub const MAX_URI: usize = 200;

#[program]
pub mod pumplite {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        nonce: u64,
        name: String,
        symbol: String,
        uri: String,
        decimals: u8,
        initial_supply: u64,
        fixed_supply: bool,
        remove_freeze: bool,
    ) -> Result<()> {
        require!((1..=MAX_NAME).contains(&name.len()), ErrorCode::InvalidName);
        require!((1..=MAX_SYMBOL).contains(&symbol.len()), ErrorCode::InvalidSymbol);
        require!(uri.len() <= MAX_URI, ErrorCode::InvalidUri);
        require!((0..=9).contains(&decimals), ErrorCode::InvalidDecimals);
        require!(initial_supply > 0, ErrorCode::InvalidSupply);

        let market = &mut ctx.accounts.market;
        market.version = 1;
        market.creator = ctx.accounts.creator.key();
        market.treasury = ctx.accounts.treasury.key();
        market.mint = ctx.accounts.mint.key();
        market.nonce = nonce;
        market.decimals = decimals;
        market.fixed_supply = fixed_supply;
        market.bump = ctx.bumps.market;
        market.mint_bump = ctx.bumps.mint;
        market.virtual_sol_reserve = DEFAULT_VIRTUAL_SOL;
        market.virtual_token_reserve = DEFAULT_VIRTUAL_TOKENS
            .checked_mul(10u128.pow(decimals as u32))
            .ok_or(ErrorCode::MathOverflow)?;
        market.real_sol_reserve = 0;
        market.real_token_reserve = initial_supply;
        market.total_volume_lamports = 0;
        market.total_buy_lamports = 0;
        market.total_sell_lamports = 0;

        let mint_seeds: &[&[u8]] = &[
            b"mint",
            ctx.accounts.creator.key.as_ref(),
            &nonce.to_le_bytes(),
            &[ctx.bumps.mint],
        ];
        let signer_seeds: &[&[&[u8]]] = &[mint_seeds];

        // Mint the initial inventory into the market vault.
        let mint_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.mint.to_account_info(),
            },
        )
        .with_signer(signer_seeds);
        token_interface::mint_to(mint_ctx, initial_supply)?;

        // Publish standard Metaplex token metadata while the mint PDA is still the mint authority.
        let metadata_cpi = CreateMetadataAccountV3CpiBuilder::new(
            &ctx.accounts.metadata_program.to_account_info(),
        )
        .metadata(&ctx.accounts.metadata.to_account_info())
        .mint(&ctx.accounts.mint.to_account_info())
        .mint_authority(&ctx.accounts.mint.to_account_info())
        .payer(&ctx.accounts.creator.to_account_info())
        .update_authority(&ctx.accounts.creator.to_account_info(), true)
        .system_program(&ctx.accounts.system_program.to_account_info())
        .data(DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        })
        .is_mutable(true);
        metadata_cpi.invoke_signed(signer_seeds)?;


        // Fixed supply: permanently remove mint authority.
        // Mintable: transfer authority to creator so future minting is explicit and visible.
        let authority = if fixed_supply {
            None
        } else {
            Some(ctx.accounts.creator.key())
        };
        let set_authority_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.mint.to_account_info(),
            },
        )
        .with_signer(signer_seeds);
        token_interface::set_authority(
            set_authority_ctx,
            anchor_spl::token_interface::spl_token_2022::instruction::AuthorityType::MintTokens,
            authority,
        )?;

        // Optionally remove freeze authority. Otherwise creator receives it.
        let freeze_authority = if remove_freeze {
            None
        } else {
            Some(ctx.accounts.creator.key())
        };
        let freeze_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.mint.to_account_info(),
            },
        )
        .with_signer(signer_seeds);
        token_interface::set_authority(
            freeze_ctx,
            anchor_spl::token_interface::spl_token_2022::instruction::AuthorityType::FreezeAccount,
            freeze_authority,
        )?;

        emit!(MarketCreated {
            market: market.key(),
            mint: ctx.accounts.mint.key(),
            creator: market.creator,
            initial_supply,
            decimals,
            fixed_supply,
        });
        Ok(())
    }

    pub fn buy(ctx: Context<Trade>, sol_in: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_in > 0, ErrorCode::InvalidAmount);
        require!(sol_in <= 50_000_000_000, ErrorCode::TradeTooLarge);

        let market = &mut ctx.accounts.market;
        let fee = fee_amount(sol_in, TOTAL_FEE_BPS)?;
        let creator_fee = fee_amount(sol_in, CREATOR_FEE_BPS)?;
        let treasury_fee = fee_amount(sol_in, TREASURY_FEE_BPS)?;
        let referral_fee = fee_amount(sol_in, REFERRAL_FEE_BPS)?;
        let reserve_fee = fee
            .checked_sub(creator_fee)
            .and_then(|x| x.checked_sub(treasury_fee))
            .and_then(|x| x.checked_sub(referral_fee))
            .ok_or(ErrorCode::MathOverflow)?;
        require!(creator_fee + treasury_fee + referral_fee + reserve_fee == fee, ErrorCode::FeeMismatch);

        let net = sol_in.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;
        let token_out = constant_product_buy(
            market.virtual_sol_reserve,
            market.virtual_token_reserve,
            net,
        )?;
        require!(token_out >= min_tokens_out, ErrorCode::SlippageExceeded);
        require!(token_out > 0 && token_out <= market.real_token_reserve, ErrorCode::InsufficientLiquidity);

        // Bind a referral on the first trade. A trader cannot refer themselves.
        let referral_key = ctx.accounts.referral_account.referrer;
        if referral_key == Pubkey::default() {
            if let Some(referrer) = nonzero_referrer(ctx.accounts.referrer.key()) {
                require!(referrer != ctx.accounts.trader.key(), ErrorCode::SelfReferral);
                ctx.accounts.referral_account.referrer = referrer;
            }
        }

        // Trader pays the gross amount. Creator, treasury and referral receive their shares;
        // reserve_fee remains in the market account as additional market-owned SOL.
        transfer_sol(&ctx.accounts.trader, &ctx.accounts.creator, creator_fee)?;
        transfer_sol(&ctx.accounts.trader, &ctx.accounts.treasury, treasury_fee)?;
        let stored_referrer = ctx.accounts.referral_account.referrer;
        if stored_referrer != Pubkey::default() {
            require_keys_eq!(stored_referrer, ctx.accounts.referrer.key(), ErrorCode::InvalidReferrer);
        }
        if stored_referrer != Pubkey::default() && referral_fee > 0 {
            transfer_sol(&ctx.accounts.trader, &ctx.accounts.referrer, referral_fee)?;
        }
        let market_payment = net.checked_add(reserve_fee).ok_or(ErrorCode::MathOverflow)?;
        transfer_sol(&ctx.accounts.trader, &ctx.accounts.market.to_account_info(), market_payment)?;

        let mint_seeds: &[&[u8]] = &[
            b"mint",
            market.creator.as_ref(),
            &market.nonce.to_le_bytes(),
            &[market.mint_bump],
        ];
        let signer_seeds: &[&[&[u8]]] = &[mint_seeds];
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.trader_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
        )
        .with_signer(&[&[
            b"market",
            market.mint.as_ref(),
            &[market.bump],
        ]]);
        token_interface::transfer_checked(transfer_ctx, token_out, market.decimals)?;

        market.virtual_sol_reserve = market.virtual_sol_reserve.checked_add(net).ok_or(ErrorCode::MathOverflow)?;
        market.virtual_token_reserve = market.virtual_token_reserve.checked_sub(token_out as u128).ok_or(ErrorCode::MathOverflow)?;
        market.real_sol_reserve = market.real_sol_reserve.checked_add(market_payment).ok_or(ErrorCode::MathOverflow)?;
        market.real_token_reserve = market.real_token_reserve.checked_sub(token_out).ok_or(ErrorCode::MathOverflow)?;
        market.total_volume_lamports = market.total_volume_lamports.checked_add(sol_in).ok_or(ErrorCode::MathOverflow)?;
        market.total_buy_lamports = market.total_buy_lamports.checked_add(sol_in).ok_or(ErrorCode::MathOverflow)?;

        emit!(TradeExecuted {
            market: market.key(),
            trader: ctx.accounts.trader.key(),
            is_buy: true,
            input_amount: sol_in,
            output_amount: token_out,
            fee,
            referral: stored_referrer,
        });
        Ok(())
    }

    pub fn sell(ctx: Context<Trade>, token_in: u64, min_sol_out: u64) -> Result<()> {
        require!(token_in > 0, ErrorCode::InvalidAmount);
        require!(token_in <= market_real_token(&ctx.accounts.market), ErrorCode::TradeTooLarge);

        let market = &mut ctx.accounts.market;
        let gross_sol = constant_product_sell(
            market.virtual_sol_reserve,
            market.virtual_token_reserve,
            token_in,
        )?;
        require!(gross_sol > 0, ErrorCode::InsufficientLiquidity);
        require!(gross_sol <= market.real_sol_reserve, ErrorCode::InsufficientLiquidity);

        let fee = fee_amount(gross_sol, TOTAL_FEE_BPS)?;
        let creator_fee = fee_amount(gross_sol, CREATOR_FEE_BPS)?;
        let treasury_fee = fee_amount(gross_sol, TREASURY_FEE_BPS)?;
        let referral_fee = fee_amount(gross_sol, REFERRAL_FEE_BPS)?;
        let reserve_fee = fee
            .checked_sub(creator_fee)
            .and_then(|x| x.checked_sub(treasury_fee))
            .and_then(|x| x.checked_sub(referral_fee))
            .ok_or(ErrorCode::MathOverflow)?;
        let net_sol = gross_sol.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;
        require!(net_sol >= min_sol_out, ErrorCode::SlippageExceeded);

        let trader_token_balance = ctx.accounts.trader_token_account.amount;
        require!(trader_token_balance >= token_in, ErrorCode::InsufficientTokens);
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.trader_token_account.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        );
        token_interface::burn(burn_ctx, token_in)?;

        let market_seeds: &[&[u8]] = &[
            b"market",
            market.mint.as_ref(),
            &[market.bump],
        ];
        let signer_seeds: &[&[&[u8]]] = &[market_seeds];
        transfer_sol_signed(&ctx.accounts.market, &ctx.accounts.creator, creator_fee, signer_seeds)?;
        transfer_sol_signed(&ctx.accounts.market, &ctx.accounts.treasury, treasury_fee, signer_seeds)?;
        let stored_referrer = ctx.accounts.referral_account.referrer;
        if stored_referrer != Pubkey::default() {
            require_keys_eq!(stored_referrer, ctx.accounts.referrer.key(), ErrorCode::InvalidReferrer);
        }
        if stored_referrer != Pubkey::default() && referral_fee > 0 {
            transfer_sol_signed(&ctx.accounts.market, &ctx.accounts.referrer, referral_fee, signer_seeds)?;
        }
        // reserve_fee stays in the market PDA.
        let payout = net_sol;
        transfer_sol_signed(&ctx.accounts.market, &ctx.accounts.trader, payout, signer_seeds)?;

        market.virtual_token_reserve = market.virtual_token_reserve.checked_add(token_in as u128).ok_or(ErrorCode::MathOverflow)?;
        market.virtual_sol_reserve = market.virtual_sol_reserve.checked_sub(gross_sol).ok_or(ErrorCode::MathOverflow)?;
        market.real_sol_reserve = market.real_sol_reserve.checked_sub(gross_sol).ok_or(ErrorCode::MathOverflow)?;
        market.real_token_reserve = market.real_token_reserve.checked_add(token_in).ok_or(ErrorCode::MathOverflow)?;
        market.total_volume_lamports = market.total_volume_lamports.checked_add(gross_sol).ok_or(ErrorCode::MathOverflow)?;
        market.total_sell_lamports = market.total_sell_lamports.checked_add(gross_sol).ok_or(ErrorCode::MathOverflow)?;

        emit!(TradeExecuted {
            market: market.key(),
            trader: ctx.accounts.trader.key(),
            is_buy: false,
            input_amount: token_in,
            output_amount: net_sol,
            fee,
            referral: stored_referrer,
        });
        Ok(())
    }
}

fn nonzero_referrer(key: Pubkey) -> Option<Pubkey> {
    if key == Pubkey::default() { None } else { Some(key) }
}

fn fee_amount(amount: u64, bps: u64) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    u64::try_from(v).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn constant_product_buy(vs: u64, vt: u128, sol_in: u64) -> Result<u64> {
    let new_vs = (vs as u128).checked_add(sol_in as u128).ok_or(ErrorCode::MathOverflow)?;
    let k = (vs as u128).checked_mul(vt).ok_or(ErrorCode::MathOverflow)?;
    let new_vt = k.checked_div(new_vs).ok_or(ErrorCode::MathOverflow)?;
    let out = vt.checked_sub(new_vt).ok_or(ErrorCode::MathOverflow)?;
    u64::try_from(out).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn constant_product_sell(vs: u64, vt: u128, token_in: u64) -> Result<u64> {
    let new_vt = vt.checked_add(token_in as u128).ok_or(ErrorCode::MathOverflow)?;
    let k = (vs as u128).checked_mul(vt).ok_or(ErrorCode::MathOverflow)?;
    let new_vs = k.checked_div(new_vt).ok_or(ErrorCode::MathOverflow)?;
    let out = (vs as u128).checked_sub(new_vs).ok_or(ErrorCode::MathOverflow)?;
    u64::try_from(out).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn market_real_token(market: &Account<Market>) -> u64 { market.real_token_reserve }

fn transfer_sol<'info>(from: &Signer<'info>, to: &AccountInfo<'info>, lamports: u64) -> Result<()> {
    require!(from.to_account_info().lamports() >= lamports, ErrorCode::InsufficientSol);
    let ix = anchor_lang::solana_program::system_instruction::transfer(&from.key(), &to.key(), lamports);
    anchor_lang::solana_program::program::invoke(&ix, &[from.to_account_info(), to.clone()])?;
    Ok(())
}

fn transfer_sol_signed<'info>(
    from: &Account<'info, Market>,
    to: &AccountInfo<'info>,
    lamports: u64,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    require!(from.to_account_info().lamports() >= lamports, ErrorCode::InsufficientLiquidity);
    **from.to_account_info().try_borrow_mut_lamports()? -= lamports;
    **to.try_borrow_mut_lamports()? += lamports;
    let _ = seeds;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64, name: String, symbol: String, uri: String, decimals: u8)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: public receiving wallet configured by PumpLite.
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        seeds = [b"mint", creator.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump,
        mint::decimals = decimals,
        mint::authority = mint,
        mint::freeze_authority = mint,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = creator,
        seeds = [b"market", mint.key().as_ref()],
        bump,
        space = 8 + Market::INIT_SPACE,
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = market,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PDA owned by Metaplex Token Metadata program.
    #[account(
        mut,
        seeds = [b"metadata", mpl_token_metadata::ID.as_ref(), mint.key().as_ref()],
        seeds::program = mpl_token_metadata::ID,
        bump,
    )]
    pub metadata: UncheckedAccount<'info>,
    #[account(address = mpl_token_metadata::ID)]
    /// CHECK: verified by address constraint.
    pub metadata_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, has_one = mint, has_one = creator, has_one = treasury)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = market, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub trader_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub creator: SystemAccount<'info>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    /// CHECK: referral account is only used as a SOL recipient after its key is stored.
    #[account(mut)]
    pub referrer: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + ReferralAccount::INIT_SPACE,
        seeds = [b"referral", market.key().as_ref(), trader.key().as_ref()],
        bump,
    )]
    pub referral_account: Account<'info, ReferralAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub version: u8,
    pub bump: u8,
    pub mint_bump: u8,
    pub decimals: u8,
    pub fixed_supply: bool,
    pub creator: Pubkey,
    pub treasury: Pubkey,
    pub mint: Pubkey,
    pub nonce: u64,
    pub virtual_sol_reserve: u64,
    pub virtual_token_reserve: u128,
    pub real_sol_reserve: u64,
    pub real_token_reserve: u64,
    pub total_volume_lamports: u64,
    pub total_buy_lamports: u64,
    pub total_sell_lamports: u64,
}

#[account]
#[derive(InitSpace)]
pub struct ReferralAccount {
    pub referrer: Pubkey,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub initial_supply: u64,
    pub decimals: u8,
    pub fixed_supply: bool,
}

#[event]
pub struct TradeExecuted {
    pub market: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub input_amount: u64,
    pub output_amount: u64,
    pub fee: u64,
    pub referral: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid token name")]
    InvalidName,
    #[msg("Invalid token symbol")]
    InvalidSymbol,
    #[msg("Invalid metadata URI")]
    InvalidUri,
    #[msg("Invalid decimals")]
    InvalidDecimals,
    #[msg("Invalid token supply")]
    InvalidSupply,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Trade is too large")]
    TradeTooLarge,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Insufficient SOL")]
    InsufficientSol,
    #[msg("Insufficient tokens")]
    InsufficientTokens,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Fee calculation mismatch")]
    FeeMismatch,
    #[msg("Self referral is not allowed")]
    SelfReferral,
    #[msg("Referral account does not match the stored referrer")]
    InvalidReferrer,
}
