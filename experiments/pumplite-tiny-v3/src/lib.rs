#![no_std]

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    no_allocator,
    nostd_panic_handler,
    program_entrypoint,
    AccountView,
    Address,
    ProgramResult,
};

use pinocchio_system::instructions::Transfer as SolTransfer;
use pinocchio_token::instructions::Transfer as TokenTransfer;

program_entrypoint!(process_instruction, 6);
no_allocator!();
nostd_panic_handler!();

const FEE_BPS: u64 = 25;
const BPS: u64 = 10_000;
const SUPPLY: u64 = 1_000_000_000_000_000;
const VIRTUAL_NATIVE: u64 = 30_000_000_000;
const DECIMALS: u8 = 6;

// 64-byte market state:
// [0..32]  mint
// [32..64] exact vault
const MARKET_STATE_LEN: usize = 64;

// Fixed amount that always remains in the market account.
// Current 64-byte account rent is below this amount.
const MARKET_FLOOR: u64 = 1_000_000;

const FIXED_BUMP: [u8; 1] = [255];
const MARKET_SEED: &[u8] = b"market";

// BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct
const TREASURY: [u8; 32] = [
    154, 43, 125, 98, 46, 105, 90, 60,
    123, 243, 131, 172, 220, 232, 145, 114,
    51, 74, 179, 173, 201, 246, 100, 32,
    206, 139, 195, 141, 70, 179, 119, 97,
];

const ERR_QUOTE: u32 = 6000;
const ERR_SLIPPAGE: u32 = 6001;
const ERR_ACCOUNT: u32 = 6002;
const ERR_BACKING: u32 = 6003;
const ERR_OVERFLOW: u32 = 6004;

#[inline(always)]
fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

#[inline(always)]
fn read_u64(
    data: &[u8],
    offset: usize,
) -> Result<u64, ProgramError> {
    let end = offset
        .checked_add(8)
        .ok_or(err(ERR_OVERFLOW))?;

    let bytes = data
        .get(offset..end)
        .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    ))
}

#[inline(always)]
fn mul_div(
    a: u64,
    b: u64,
    d: u64,
) -> Result<u64, ProgramError> {
    if d == 0 {
        return Err(err(ERR_OVERFLOW));
    }

    let n = (a as u128)
        .checked_mul(b as u128)
        .ok_or(err(ERR_OVERFLOW))?;

    let result = n
        .checked_div(d as u128)
        .ok_or(err(ERR_OVERFLOW))?;

    u64::try_from(result)
        .map_err(|_| err(ERR_OVERFLOW))
}

#[inline(always)]
fn fee(amount: u64) -> Result<u64, ProgramError> {
    mul_div(amount, FEE_BPS, BPS)
}

#[inline(always)]
fn quote_buy(
    native: u64,
    tokens: u64,
    input: u64,
) -> Result<(u64, u64), ProgramError> {
    if input == 0 || tokens == 0 {
        return Err(err(ERR_QUOTE));
    }

    let fees = fee(input)?;

    let net = input
        .checked_sub(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    let denominator = VIRTUAL_NATIVE
        .checked_add(native)
        .and_then(|v| v.checked_add(net))
        .ok_or(err(ERR_OVERFLOW))?;

    let output = mul_div(
        tokens,
        net,
        denominator,
    )?;

    if output == 0 || output >= tokens {
        return Err(err(ERR_QUOTE));
    }

    Ok((output, fees))
}

#[inline(always)]
fn quote_sell(
    native: u64,
    tokens: u64,
    input: u64,
) -> Result<(u64, u64), ProgramError> {
    if input == 0 || tokens == 0 {
        return Err(err(ERR_QUOTE));
    }

    let denominator = tokens
        .checked_add(input)
        .ok_or(err(ERR_OVERFLOW))?;

    if denominator > SUPPLY {
        return Err(err(ERR_QUOTE));
    }

    let priced = VIRTUAL_NATIVE
        .checked_add(native)
        .ok_or(err(ERR_OVERFLOW))?;

    let gross = mul_div(
        priced,
        input,
        denominator,
    )?;

    if gross == 0 || gross > native {
        return Err(err(ERR_BACKING));
    }

    Ok((gross, fee(gross)?))
}

#[inline(always)]
fn check_mint(mint: &AccountView) -> ProgramResult {
    if !mint.owned_by(&pinocchio_token::ID) {
        return Err(ProgramError::IncorrectProgramId);
    }

    let data = mint.try_borrow()?;

    if data.len() != 82 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Mint authority None.
    if data[0..4] != [0, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    // Freeze authority None.
    if data[46..50] != [0, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    if data[44] != DECIMALS || data[45] != 1 {
        return Err(err(ERR_ACCOUNT));
    }

    // Supply may fall through user burns but must never exceed
    // the original fixed PumpLite supply.
    if read_u64(&data, 36)? > SUPPLY {
        return Err(err(ERR_ACCOUNT));
    }

    Ok(())
}

#[inline(always)]
fn token_amount(
    account: &AccountView,
    mint: &Address,
    owner: &Address,
) -> Result<u64, ProgramError> {
    if !account.owned_by(&pinocchio_token::ID) {
        return Err(ProgramError::IncorrectProgramId);
    }

    let data = account.try_borrow()?;

    if data.len() != 165 {
        return Err(ProgramError::InvalidAccountData);
    }

    if &data[0..32] != mint.as_ref() {
        return Err(err(ERR_ACCOUNT));
    }

    if &data[32..64] != owner.as_ref() {
        return Err(err(ERR_ACCOUNT));
    }

    // Initialized; frozen accounts are rejected.
    if data[108] != 1 {
        return Err(err(ERR_ACCOUNT));
    }

    read_u64(&data, 64)
}

#[inline(always)]
fn check_accounts(
    program_id: &Address,
    trader: &AccountView,
    market: &AccountView,
    mint: &AccountView,
    vault: &AccountView,
    trader_tokens: &AccountView,
    treasury: &AccountView,
) -> Result<(u64, u64), ProgramError> {
    if !trader.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if treasury.address().as_array() != &TREASURY {
        return Err(err(ERR_ACCOUNT));
    }

    if !market.owned_by(program_id) {
        return Err(err(ERR_ACCOUNT));
    }

    // Market identity is written once by init_market.
    // This replaces runtime SHA-256 PDA derivation.
    {
        let state = market.try_borrow()?;

        if state.len() != MARKET_STATE_LEN {
            return Err(err(ERR_ACCOUNT));
        }

        if &state[0..32] != mint.address().as_ref() {
            return Err(err(ERR_ACCOUNT));
        }

        if &state[32..64] != vault.address().as_ref() {
            return Err(err(ERR_ACCOUNT));
        }
    }

    check_mint(mint)?;

    // Exact stored vault must contain this mint and be owned by market.
    let tokens = token_amount(
        vault,
        mint.address(),
        market.address(),
    )?;

    // Trader account must contain this mint and be owned by signer.
    token_amount(
        trader_tokens,
        mint.address(),
        trader.address(),
    )?;

    // Actual SOL is actual curve backing.
    let native = market
        .lamports()
        .checked_sub(MARKET_FLOOR)
        .ok_or(err(ERR_BACKING))?;

    Ok((native, tokens))
}

fn buy(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [
        trader,
        market,
        mint,
        vault,
        trader_tokens,
        treasury,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let input = read_u64(data, 0)?;
    let minimum_output = read_u64(data, 8)?;

    if minimum_output == 0 {
        return Err(err(ERR_SLIPPAGE));
    }

    let (native, tokens) = check_accounts(
        program_id,
        trader,
        market,
        mint,
        vault,
        trader_tokens,
        treasury,
    )?;

    let (output, fees) = quote_buy(
        native,
        tokens,
        input,
    )?;

    if output < minimum_output {
        return Err(err(ERR_SLIPPAGE));
    }

    let net = input
        .checked_sub(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    SolTransfer {
        from: trader,
        to: treasury,
        lamports: fees,
    }
    .invoke()?;

    SolTransfer {
        from: trader,
        to: market,
        lamports: net,
    }
    .invoke()?;

    // This CPI also proves that market is the expected market PDA:
    // the SPL Token program accepts the transfer only if the
    // invoke_signed seeds produce market.address().
    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [Signer::from(&seeds)];

    TokenTransfer {
        multisig_signers: &[] as &[&AccountView],
        from: vault,
        to: trader_tokens,
        authority: market,
        amount: output,
    }
    .invoke_signed(&signers)?;

    Ok(())
}

fn sell(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [
        trader,
        market,
        mint,
        vault,
        trader_tokens,
        treasury,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let input = read_u64(data, 0)?;
    let minimum_output = read_u64(data, 8)?;

    if minimum_output == 0 {
        return Err(err(ERR_SLIPPAGE));
    }

    let (native, tokens) = check_accounts(
        program_id,
        trader,
        market,
        mint,
        vault,
        trader_tokens,
        treasury,
    )?;

    let (gross, fees) = quote_sell(
        native,
        tokens,
        input,
    )?;

    let output = gross
        .checked_sub(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    if output < minimum_output {
        return Err(err(ERR_SLIPPAGE));
    }

    // Tokens first. Transaction atomicity rolls this back if
    // any later operation fails.
    TokenTransfer {
        multisig_signers: &[] as &[&AccountView],
        from: trader_tokens,
        to: vault,
        authority: trader,
        amount: input,
    }
    .invoke()?;

    // gross <= native means MARKET_FLOOR remains untouched.
    let market_after = market
        .lamports()
        .checked_sub(gross)
        .ok_or(err(ERR_BACKING))?;

    let treasury_after = treasury
        .lamports()
        .checked_add(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    let trader_after = trader
        .lamports()
        .checked_add(output)
        .ok_or(err(ERR_OVERFLOW))?;

    market.set_lamports(market_after);
    treasury.set_lamports(treasury_after);
    trader.set_lamports(trader_after);

    Ok(())
}

fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *tag {
        0 => buy(program_id, accounts, data),
        1 => sell(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_25_bps() {
        assert_eq!(
            fee(1_000_000).unwrap(),
            2_500
        );
    }

    #[test]
    fn round_trip_preserves_inventory_and_cannot_profit() {
        for amount in [
            1_000u64,
            1_000_000,
            1_000_000_000,
            50_000_000_000,
        ] {
            let (out, buy_fee) =
                quote_buy(0, SUPPLY, amount).unwrap();

            let reserve = amount - buy_fee;

            let (gross, sell_fee) =
                quote_sell(
                    reserve,
                    SUPPLY - out,
                    out,
                )
                .unwrap();

            assert!(gross <= reserve);
            assert!(gross - sell_fee < amount);
            assert_eq!((SUPPLY - out) + out, SUPPLY);

            let k_before =
                (VIRTUAL_NATIVE as u128) *
                SUPPLY as u128;

            let k_after =
                (VIRTUAL_NATIVE as u128 + reserve as u128) *
                (SUPPLY - out) as u128;

            assert!(k_after >= k_before);
        }
    }

    #[test]
    fn rejects_unbacked_and_overflow() {
        assert!(quote_sell(0, SUPPLY, 1).is_err());
        assert!(quote_buy(u64::MAX, SUPPLY, 1).is_err());
        assert!(quote_buy(0, SUPPLY, 0).is_err());
        assert!(quote_sell(1, u64::MAX, 1).is_err());
    }

    #[test]
    fn many_trades_conserve_supply_and_backing() {
        let mut native = 0u64;
        let mut tokens = SUPPLY;
        let mut held = 0u64;

        for i in 1..=1000u64 {
            let input = i * 7919 + 10000;

            let (out, f) =
                quote_buy(native, tokens, input).unwrap();

            native += input - f;
            tokens -= out;
            held += out;

            let old_k =
                (VIRTUAL_NATIVE as u128 + native as u128) *
                tokens as u128;

            let sold = held / 3;

            if sold != 0 {
                let (gross, _) =
                    quote_sell(native, tokens, sold).unwrap();

                native -= gross;
                tokens += sold;
                held -= sold;
            }

            assert_eq!(tokens + held, SUPPLY);

            assert!(
                (VIRTUAL_NATIVE as u128 + native as u128) *
                tokens as u128 >= old_k
            );
        }
    }
}