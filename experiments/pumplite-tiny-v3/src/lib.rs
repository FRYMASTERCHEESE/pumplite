#![no_std]

use core::{mem::MaybeUninit, slice::from_raw_parts};

use pinocchio::{
    cpi::{invoke_signed_unchecked, CpiAccount, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    no_allocator, nostd_panic_handler, program_entrypoint, AccountView, Address, ProgramResult,
};

program_entrypoint!(process_instruction, 5);
no_allocator!();
nostd_panic_handler!();

const SUPPLY: u64 = 1_000_000_000_000_000;

const VIRTUAL_NATIVE: u64 = 30_000_000_000;

const DECIMALS: u8 = 6;

const MARKET_SEED: &[u8] = b"market";

const FIXED_BUMP: [u8; 1] = [255];

const SYSTEM_ID: Address = Address::new_from_array([0u8; 32]);

const TOKEN_ID: Address = Address::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);

// BNpFPPuy2h12dryy4dayemjA4YS17ccVaF82jBDuiwct
const TREASURY: [u8; 32] = [
    154, 43, 125, 98, 46, 105, 90, 60, 123, 243, 131, 172, 220, 232, 145, 114, 51, 74, 179, 173,
    201, 246, 100, 32, 206, 139, 195, 141, 70, 179, 119, 97,
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
fn u64_at(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ))
}

#[inline(always)]
fn fee(amount: u64) -> u64 {
    // Exactly 25 basis points.
    amount / 400
}
#[inline(never)]
fn system_transfer(
    from: &AccountView,
    to: &AccountView,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let accounts = [
        InstructionAccount::writable_signer(from.address()),
        InstructionAccount::writable(to.address()),
    ];

    let mut data = [0u8; 12];

    data[0..4].copy_from_slice(&2u32.to_le_bytes());

    data[4..12].copy_from_slice(&amount.to_le_bytes());

    let instruction = InstructionView {
        program_id: &SYSTEM_ID,
        accounts: &accounts,
        data: &data,
    };

    if from.is_borrowed() | to.is_borrowed() {
        return Err(ProgramError::AccountBorrowFailed);
    }

    let mut cpi = [const { MaybeUninit::<CpiAccount>::uninit() }; 2];

    CpiAccount::init_from_account_view(from, &mut cpi[0]);

    CpiAccount::init_from_account_view(to, &mut cpi[1]);

    unsafe {
        invoke_signed_unchecked(&instruction, from_raw_parts(cpi.as_ptr() as _, 2), signers);
    }

    Ok(())
}

#[inline(always)]
fn token_mint_to(
    mint: &AccountView,
    destination: &AccountView,
    authority: &AccountView,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let accounts = [
        InstructionAccount::writable(mint.address()),
        InstructionAccount::writable(destination.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];

    let mut data = [0u8; 9];

    data[0] = 7;

    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let instruction = InstructionView {
        program_id: &TOKEN_ID,
        accounts: &accounts,
        data: &data,
    };

    let mut cpi = [const { MaybeUninit::<CpiAccount>::uninit() }; 3];

    CpiAccount::init_from_account_view(mint, &mut cpi[0]);

    CpiAccount::init_from_account_view(destination, &mut cpi[1]);

    CpiAccount::init_from_account_view(authority, &mut cpi[2]);

    unsafe {
        invoke_signed_unchecked(&instruction, from_raw_parts(cpi.as_ptr() as _, 3), signers);
    }

    Ok(())
}

#[inline(always)]
fn token_burn(
    account: &AccountView,
    mint: &AccountView,
    authority: &AccountView,
    amount: u64,
) -> ProgramResult {
    let accounts = [
        InstructionAccount::writable(account.address()),
        InstructionAccount::writable(mint.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];

    let mut data = [0u8; 9];

    data[0] = 8;

    data[1..9].copy_from_slice(&amount.to_le_bytes());

    let instruction = InstructionView {
        program_id: &TOKEN_ID,
        accounts: &accounts,
        data: &data,
    };

    let mut cpi = [const { MaybeUninit::<CpiAccount>::uninit() }; 3];

    CpiAccount::init_from_account_view(account, &mut cpi[0]);

    CpiAccount::init_from_account_view(mint, &mut cpi[1]);

    CpiAccount::init_from_account_view(authority, &mut cpi[2]);

    unsafe {
        invoke_signed_unchecked(&instruction, from_raw_parts(cpi.as_ptr() as _, 3), &[]);
    }

    Ok(())
}

#[inline(never)]
fn remaining_tokens(mint: &AccountView, market: &AccountView) -> Result<u64, ProgramError> {
    if !mint.owned_by(&TOKEN_ID) {
        return Err(ProgramError::IncorrectProgramId);
    }

    let data = mint.try_borrow()?;

    if data.len() != 82 {
        return Err(ProgramError::InvalidAccountData);
    }

    if data[44] != DECIMALS || data[45] != 1 {
        return Err(err(ERR_ACCOUNT));
    }

    // Mint authority Some(market PDA).
    if data[0..4] != [1, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    if &data[4..36] != market.address().as_ref() {
        return Err(err(ERR_ACCOUNT));
    }

    // Freeze authority permanently None.
    if data[46..50] != [0, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    let circulating = u64_at(&data, 36)?;

    let remaining = SUPPLY.checked_sub(circulating).ok_or(err(ERR_ACCOUNT))?;

    if remaining == 0 {
        return Err(err(ERR_QUOTE));
    }

    Ok(remaining)
}

#[inline(never)]
fn check_accounts(trader: &AccountView, treasury: &AccountView) -> ProgramResult {
    if !trader.is_signer() || !trader.is_writable() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if treasury.address().as_array() != &TREASURY {
        return Err(err(ERR_ACCOUNT));
    }

    if !treasury.is_writable() {
        return Err(err(ERR_ACCOUNT));
    }

    Ok(())
}

fn buy(accounts: &mut [AccountView], input: u64, requested: u64, minimum: u64) -> ProgramResult {
    let [trader, market, mint, trader_tokens, treasury] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_accounts(trader, treasury)?;

    let tokens = remaining_tokens(mint, market)?;

    let native = market.lamports();

    let f = fee(input);

    let net = input.checked_sub(f).ok_or(err(ERR_OVERFLOW))?;

    if requested == 0 || requested > tokens || requested < minimum {
        return Err(err(ERR_SLIPPAGE));
    }

    let before_native = VIRTUAL_NATIVE
        .checked_add(native)
        .ok_or(err(ERR_OVERFLOW))?;

    let after_native = before_native.checked_add(net).ok_or(err(ERR_OVERFLOW))?;

    let after_tokens = tokens - requested;

    // Constant-product safety:
    //
    // (native after) * (tokens after)
    // must never fall below the pre-trade invariant.
    //
    // This allows a user to request LESS than the
    // curve quote, but never MORE.
    if (after_native as u128) * (after_tokens as u128) < (before_native as u128) * (tokens as u128)
    {
        return Err(err(ERR_QUOTE));
    }

    // 0.25% PumpLite fee.
    system_transfer(trader, treasury, f, &[])?;

    // Curve backing.
    system_transfer(trader, market, net, &[])?;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [Signer::from(&seeds)];

    token_mint_to(mint, trader_tokens, market, requested, &signers)?;

    Ok(())
}

fn sell(accounts: &mut [AccountView], input: u64, requested: u64, minimum: u64) -> ProgramResult {
    let [trader, market, mint, trader_tokens, treasury] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_accounts(trader, treasury)?;

    let tokens = remaining_tokens(mint, market)?;

    let native = market.lamports();

    let gross = requested;

    if gross == 0 || gross > native {
        return Err(err(ERR_BACKING));
    }

    let f = fee(gross);

    let output = gross.checked_sub(f).ok_or(err(ERR_OVERFLOW))?;

    if output < minimum {
        return Err(err(ERR_SLIPPAGE));
    }

    let before_native = VIRTUAL_NATIVE
        .checked_add(native)
        .ok_or(err(ERR_OVERFLOW))?;

    let after_native = before_native.checked_sub(gross).ok_or(err(ERR_BACKING))?;

    let after_tokens = tokens.checked_add(input).ok_or(err(ERR_OVERFLOW))?;

    // A seller may withdraw less than the curve permits,
    // but can never withdraw more.
    if (after_native as u128) * (after_tokens as u128) < (before_native as u128) * (tokens as u128)
    {
        return Err(err(ERR_QUOTE));
    }

    token_burn(trader_tokens, mint, trader, input)?;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [Signer::from(&seeds)];

    system_transfer(market, treasury, f, &signers)?;

    system_transfer(market, trader, output, &signers)?;

    Ok(())
}

fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() != 25 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let tag = instruction_data[0];

    let input = u64_at(instruction_data, 1)?;

    let requested = u64_at(instruction_data, 9)?;

    let minimum = u64_at(instruction_data, 17)?;

    if input == 0 {
        return Err(err(ERR_QUOTE));
    }

    if minimum == 0 {
        return Err(err(ERR_SLIPPAGE));
    }

    match tag {
        0 => buy(accounts, input, requested, minimum),

        1 => sell(accounts, input, requested, minimum),

        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_25_bps() {
        for amount in [400u64, 1_000, 1_000_000, 1_000_000_000] {
            assert_eq!(fee(amount), ((amount as u128) * 25 / 10_000) as u64);
        }
    }

    #[test]
    fn compact_math_matches_reference() {
        let native = 5_000_000_000u64;
        let tokens = 900_000_000_000_000u64;
        let input = 1_000_000_000u64;

        let net = input - fee(input);

        let before_native = VIRTUAL_NATIVE + native;

        let after_native = before_native + net;

        let output = ((tokens as u128) * (net as u128) / (after_native as u128)) as u64;

        let left = (after_native as u128) * ((tokens - output) as u128);

        let right = (before_native as u128) * (tokens as u128);

        assert!(left >= right);

        let too_many = output + 1;

        let bad = (after_native as u128) * ((tokens - too_many) as u128);

        assert!(bad < right);
    }

    #[test]
    fn sell_invariant_rejects_overpayment() {
        let native = 10_000_000_000u64;
        let tokens = 800_000_000_000_000u64;
        let input = 10_000_000_000_000u64;

        let before_native = VIRTUAL_NATIVE + native;

        let after_tokens = tokens + input;

        let gross = ((before_native as u128) * (input as u128) / (after_tokens as u128)) as u64;

        let left = ((before_native - gross) as u128) * (after_tokens as u128);

        let right = (before_native as u128) * (tokens as u128);

        assert!(left >= right);

        let too_much = gross + 1;

        let bad = ((before_native - too_much) as u128) * (after_tokens as u128);

        assert!(bad < right);
    }
}
