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
use pinocchio_token::instructions::{Burn, MintTo};

program_entrypoint!(process_instruction, 5);
no_allocator!();
nostd_panic_handler!();

const SUPPLY: u64 = 1_000_000_000_000_000;
const VIRTUAL_NATIVE: u64 = 30_000_000_000;
const DECIMALS: u8 = 6;

const MARKET_SEED: &[u8] = b"market";
const FIXED_BUMP: [u8; 1] = [255];

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
fn u64_at(
    data: &[u8],
    offset: usize,
) -> Result<u64, ProgramError> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?
    ))
}

// Exact floor(a*b/d), without u128.
//
// PumpLite only calls this when b < d.
// This is true for both:
// BUY:  net < virtual + native + net
// SELL: input < remaining_tokens + input
//
// q/r hold the quotient/remainder while multiplying by the
// bits of b. No 128-bit division runtime is required.
#[inline(never)]
fn mul_div_ratio(
    a: u64,
    b: u64,
    d: u64,
) -> Result<u64, ProgramError> {
    if d == 0 || b >= d {
        return Err(err(ERR_OVERFLOW));
    }

    let mut q = 0u64;
    let mut r = 0u64;

    let mut aq = a / d;
    let mut ar = a % d;
    let mut x = b;

    while x != 0 {
        if x & 1 != 0 {
            q = q
                .checked_add(aq)
                .ok_or(err(ERR_OVERFLOW))?;

            let gap = d - ar;

            if r >= gap {
                r -= gap;

                q = q
                    .checked_add(1)
                    .ok_or(err(ERR_OVERFLOW))?;
            } else {
                r += ar;
            }
        }

        x >>= 1;

        if x == 0 {
            break;
        }

        let gap = d - ar;
        let carry;

        if ar >= gap {
            ar -= gap;
            carry = 1u64;
        } else {
            ar += ar;
            carry = 0u64;
        }

        aq = aq
            .checked_mul(2)
            .and_then(|v| v.checked_add(carry))
            .ok_or(err(ERR_OVERFLOW))?;
    }

    Ok(q)
}

// 25 / 10,000 reduces exactly to 1 / 400.
//
// floor(amount * 25 / 10,000) == floor(amount / 400)
#[inline(always)]
fn fee(amount: u64) -> u64 {
    amount / 400
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

    let fees = fee(input);

    let net = input
        .checked_sub(fees)
        .ok_or(err(ERR_OVERFLOW))?;

    let denominator = VIRTUAL_NATIVE
        .checked_add(native)
        .and_then(|v| v.checked_add(net))
        .ok_or(err(ERR_OVERFLOW))?;

    let output = mul_div_ratio(
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

    let priced = VIRTUAL_NATIVE
        .checked_add(native)
        .ok_or(err(ERR_OVERFLOW))?;

    let gross = mul_div_ratio(
        priced,
        input,
        denominator,
    )?;

    if gross == 0 || gross > native {
        return Err(err(ERR_BACKING));
    }

    Ok((gross, fee(gross)))
}

// The mint itself replaces the old token vault.
//
// Current mint supply = circulating tokens.
// SUPPLY - current supply = curve inventory.
//
// Static safety:
// - classic SPL Token only
// - exactly 6 decimals
// - initialized
// - no freeze authority
// - market PDA is the mint authority
// - supply can never exceed PumpLite maximum
#[inline(always)]
fn remaining_tokens(
    mint: &AccountView,
    market: &AccountView,
) -> Result<u64, ProgramError> {
    if !mint.owned_by(&pinocchio_token::ID) {
        return Err(ProgramError::IncorrectProgramId);
    }

    let data = mint.try_borrow()?;

    if data.len() != 82 {
        return Err(ProgramError::InvalidAccountData);
    }

    if data[44] != DECIMALS || data[45] != 1 {
        return Err(err(ERR_ACCOUNT));
    }

    // Mint authority must be Some(market).
    if data[0..4] != [1, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    if &data[4..36] != market.address().as_ref() {
        return Err(err(ERR_ACCOUNT));
    }

    // Freeze authority must permanently be None.
    if data[46..50] != [0, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    let circulating = u64_at(&data, 36)?;

    let remaining = SUPPLY
        .checked_sub(circulating)
        .ok_or(err(ERR_ACCOUNT))?;

    if remaining == 0 {
        return Err(err(ERR_QUOTE));
    }

    Ok(remaining)
}

#[inline(always)]
fn check_treasury(
    treasury: &AccountView,
) -> ProgramResult {
    if treasury.address().as_array() != &TREASURY {
        return Err(err(ERR_ACCOUNT));
    }

    Ok(())
}

// Accounts for BUY and SELL:
//
// 0 trader          writable signer
// 1 market PDA      writable
// 2 mint            writable
// 3 trader tokens   writable
// 4 fixed treasury  writable
//
// No vault.
// No market-state account.
// No SHA256 PDA derivation.
// No Clock syscall.
fn buy(
    accounts: &mut [AccountView],
    input: u64,
    minimum_output: u64,
) -> ProgramResult {
    let [
        trader,
        market,
        mint,
        trader_tokens,
        treasury,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_treasury(treasury)?;

    let tokens = remaining_tokens(
        mint,
        market,
    )?;

    let native = market.lamports();

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

    // User pays fixed PumpLite fee.
    SolTransfer {
        from: trader,
        to: treasury,
        lamports: fees,
    }
    .invoke()?;

    // Remaining SOL becomes real curve backing.
    SolTransfer {
        from: trader,
        to: market,
        lamports: net,
    }
    .invoke()?;

    // The market PDA is the mint authority.
    //
    // This signed CPI simultaneously proves:
    // 1. market is the PDA for this exact mint
    // 2. market is the mint authority
    // 3. destination is a valid account for this mint
    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [Signer::from(&seeds)];

    MintTo::new(
        mint,
        trader_tokens,
        market,
        output,
    )
    .invoke_signed(&signers)?;

    Ok(())
}

fn sell(
    accounts: &mut [AccountView],
    input: u64,
    minimum_output: u64,
) -> ProgramResult {
    let [
        trader,
        market,
        mint,
        trader_tokens,
        treasury,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_treasury(treasury)?;

    let tokens = remaining_tokens(
        mint,
        market,
    )?;

    let native = market.lamports();

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

    // Burn first.
    //
    // SPL Token verifies:
    // - trader signature
    // - trader owns/delegates this token account
    // - account belongs to this mint
    // - trader has enough tokens
    //
    // Atomic transaction rollback restores the burn if a later
    // SOL transfer fails.
    Burn::new(
        trader_tokens,
        mint,
        trader,
        input,
    )
    .invoke()?;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [Signer::from(&seeds)];

    // Market PDA pays the fixed fee.
    // invoke_signed proves this is the market PDA for this mint.
    SolTransfer {
        from: market,
        to: treasury,
        lamports: fees,
    }
    .invoke_signed(&signers)?;

    // Market PDA pays the seller.
    SolTransfer {
        from: market,
        to: trader,
        lamports: output,
    }
    .invoke_signed(&signers)?;

    Ok(())
}

fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // tag + input + minimum_output
    if instruction_data.len() != 17 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let tag = instruction_data[0];
    let input = u64_at(instruction_data, 1)?;
    let minimum_output = u64_at(instruction_data, 9)?;

    if input == 0 {
        return Err(err(ERR_QUOTE));
    }

    if minimum_output == 0 {
        return Err(err(ERR_SLIPPAGE));
    }

    match tag {
        0 => buy(
            accounts,
            input,
            minimum_output,
        ),

        1 => sell(
            accounts,
            input,
            minimum_output,
        ),

        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_mul_div(
        a: u64,
        b: u64,
        d: u64,
    ) -> u64 {
        (
            (a as u128) *
            (b as u128) /
            (d as u128)
        ) as u64
    }

    #[test]
    fn fee_is_exact_original_25_bps() {
        for amount in [
            1u64,
            399,
            400,
            1_000,
            1_000_000,
            1_000_000_000,
            u32::MAX as u64,
            u64::MAX,
        ] {
            let original =
                (
                    (amount as u128) *
                    25u128 /
                    10_000u128
                ) as u64;

            assert_eq!(
                fee(amount),
                original
            );
        }
    }

    #[test]
    fn compact_mul_div_matches_u128_reference() {
        let values = [
            1u64,
            2,
            3,
            7,
            31,
            255,
            1_000,
            1_000_000,
            30_000_000_000,
            1_000_000_000_000_000,
            u32::MAX as u64,
            u64::MAX / 4,
            u64::MAX / 2,
            u64::MAX,
        ];

        for &a in &values {
            for &d0 in &values {
                let d = d0.max(2);

                for &b0 in &values {
                    let b = b0 % d;

                    assert_eq!(
                        mul_div_ratio(a, b, d).unwrap(),
                        reference_mul_div(a, b, d)
                    );
                }
            }
        }
    }

    #[test]
    fn round_trip_preserves_curve_and_cannot_profit() {
        for amount in [
            1_000u64,
            1_000_000,
            1_000_000_000,
            50_000_000_000,
        ] {
            let (out, buy_fee) =
                quote_buy(
                    0,
                    SUPPLY,
                    amount,
                )
                .unwrap();

            let native =
                amount - buy_fee;

            let remaining =
                SUPPLY - out;

            let (gross, sell_fee) =
                quote_sell(
                    native,
                    remaining,
                    out,
                )
                .unwrap();

            assert!(gross <= native);
            assert!(gross - sell_fee < amount);

            let ref_buy =
                reference_mul_div(
                    SUPPLY,
                    amount - fee(amount),
                    VIRTUAL_NATIVE +
                        amount -
                        fee(amount),
                );

            assert_eq!(out, ref_buy);
        }
    }

    #[test]
    fn many_trades_conserve_supply_and_backing() {
        let mut native = 0u64;
        let mut remaining = SUPPLY;
        let mut circulating = 0u64;

        for i in 1..=1000u64 {
            let input =
                i * 7_919 + 10_000;

            let (out, f) =
                quote_buy(
                    native,
                    remaining,
                    input,
                )
                .unwrap();

            native += input - f;
            remaining -= out;
            circulating += out;

            let sold =
                circulating / 3;

            if sold != 0 {
                let (gross, _) =
                    quote_sell(
                        native,
                        remaining,
                        sold,
                    )
                    .unwrap();

                native -= gross;
                remaining += sold;
                circulating -= sold;
            }

            assert_eq!(
                remaining + circulating,
                SUPPLY
            );
        }
    }

    #[test]
    fn bad_values_fail_closed() {
        assert!(
            quote_buy(
                0,
                SUPPLY,
                0
            )
            .is_err()
        );

        assert!(
            quote_sell(
                0,
                SUPPLY,
                1
            )
            .is_err()
        );

        assert!(
            quote_buy(
                u64::MAX,
                SUPPLY,
                1
            )
            .is_err()
        );
    }
}