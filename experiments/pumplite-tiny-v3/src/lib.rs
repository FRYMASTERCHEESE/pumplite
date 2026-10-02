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
use pinocchio_token::instructions::{
    MintTo,
    Transfer as TokenTransfer,
};

program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

const FEE_BPS: u64 = 25;
const BPS: u64 = 10_000;
const SUPPLY: u64 = 1_000_000_000_000_000;
const VIRTUAL_NATIVE: u64 = 30_000_000_000;

const ERR_OVERFLOW: u32 = 6000;
const ERR_AMOUNT: u32 = 6001;
const ERR_LIQUIDITY: u32 = 6002;
const ERR_SLIPPAGE: u32 = 6003;

#[inline(always)]
fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

#[inline(always)]
fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
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
fn mul_div(a: u64, b: u64, d: u64) -> Result<u64, ProgramError> {
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
fn buy(
    native: u64,
    tokens: u64,
    input: u64,
) -> Result<(u64, u64), ProgramError> {
    if input == 0 || tokens == 0 {
        return Err(err(ERR_AMOUNT));
    }

    let fees = fee(input)?;

    let net = input
        .checked_sub(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    let denominator = VIRTUAL_NATIVE
        .checked_add(native)
        .and_then(|v| v.checked_add(net))
        .ok_or(err(ERR_OVERFLOW))?;

    let output = mul_div(tokens, net, denominator)?;

    if output == 0 || output >= tokens {
        return Err(err(ERR_LIQUIDITY));
    }

    Ok((output, fees))
}

#[inline(always)]
fn sell(
    native: u64,
    tokens: u64,
    input: u64,
) -> Result<(u64, u64), ProgramError> {
    if input == 0 || tokens == 0 {
        return Err(err(ERR_AMOUNT));
    }

    let denominator = tokens
        .checked_add(input)
        .ok_or(err(ERR_OVERFLOW))?;

    if denominator > SUPPLY {
        return Err(err(ERR_LIQUIDITY));
    }

    let priced = VIRTUAL_NATIVE
        .checked_add(native)
        .ok_or(err(ERR_OVERFLOW))?;

    let gross = mul_div(priced, input, denominator)?;

    if gross == 0 || gross > native {
        return Err(err(ERR_LIQUIDITY));
    }

    Ok((gross, fee(gross)?))
}

#[inline(always)]
fn write_quote(
    account: &mut AccountView,
    output: u64,
    fee: u64,
) -> ProgramResult {
    if !account.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut data = account.try_borrow_mut()?;

    if data.len() < 16 {
        return Err(ProgramError::AccountDataTooSmall);
    }

    data[0..8].copy_from_slice(&output.to_le_bytes());
    data[8..16].copy_from_slice(&fee.to_le_bytes());

    Ok(())
}

fn quote_buy(
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [result, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let native = read_u64(data, 0)?;
    let tokens = read_u64(data, 8)?;
    let input = read_u64(data, 16)?;
    let minimum = read_u64(data, 24)?;

    let (output, fees) = buy(native, tokens, input)?;

    if output < minimum {
        return Err(err(ERR_SLIPPAGE));
    }

    write_quote(result, output, fees)
}

fn quote_sell(
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [result, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let native = read_u64(data, 0)?;
    let tokens = read_u64(data, 8)?;
    let input = read_u64(data, 16)?;
    let minimum = read_u64(data, 24)?;

    let (gross, fees) = sell(native, tokens, input)?;

    let output = gross
        .checked_sub(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    if output < minimum {
        return Err(err(ERR_SLIPPAGE));
    }

    write_quote(result, output, fees)
}

fn transfer_sol(
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [payer, recipient, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = read_u64(data, 0)?;

    SolTransfer {
        from: payer,
        to: recipient,
        lamports: amount,
    }
    .invoke()
}

fn transfer_tokens_signed(
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [mint, source, destination, authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = read_u64(data, 0)?;

    let bump = *data
        .get(8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    let bump_bytes = [bump];

    let seeds = [
        Seed::from(&b"market"[..]),
        Seed::from(&mint.address().as_array()[..]),
        Seed::from(&bump_bytes[..]),
    ];

    let signers = [Signer::from(&seeds)];

    TokenTransfer {
        multisig_signers: &[] as &[&AccountView],
        from: source,
        to: destination,
        authority,
        amount,
    }
    .invoke_signed(&signers)
}

fn mint_tokens_signed(
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [mint, destination, authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = read_u64(data, 0)?;

    let bump = *data
        .get(8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    let bump_bytes = [bump];

    let seeds = [
        Seed::from(&b"market"[..]),
        Seed::from(&mint.address().as_array()[..]),
        Seed::from(&bump_bytes[..]),
    ];

    let signers = [Signer::from(&seeds)];

    MintTo {
        multisig_signers: &[] as &[&AccountView],
        mint,
        account: destination,
        mint_authority: authority,
        amount,
    }
    .invoke_signed(&signers)
}

fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *tag {
        0 => quote_buy(accounts, data),
        1 => quote_sell(accounts, data),
        2 => transfer_sol(accounts, data),
        3 => transfer_tokens_signed(accounts, data),
        4 => mint_tokens_signed(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
