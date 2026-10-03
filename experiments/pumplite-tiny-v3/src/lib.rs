#![no_std]

use core::{
    mem::MaybeUninit,
    slice::from_raw_parts,
};

use pinocchio::{
    cpi::{
        invoke_signed_unchecked,
        CpiAccount,
        Seed,
        Signer,
    },
    error::ProgramError,
    instruction::{
        InstructionAccount,
        InstructionView,
    },
    no_allocator,
    nostd_panic_handler,
    program_entrypoint,
    AccountView,
    Address,
    ProgramResult,
};

program_entrypoint!(process_instruction, 5);
no_allocator!();
nostd_panic_handler!();

const SUPPLY: u64 =
    1_000_000_000_000_000;

const VIRTUAL_NATIVE: u64 =
    30_000_000_000;

const DECIMALS: u8 = 6;

const MARKET_SEED: &[u8] =
    b"market";

const FIXED_BUMP: [u8; 1] =
    [255];

const SYSTEM_ID: Address =
    Address::new_from_array([0u8; 32]);

const TOKEN_ID: Address =
    Address::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147,
        217, 203, 225, 70, 206, 235, 121, 172,
        28, 180, 133, 237, 95, 91, 55, 145,
        58, 140, 245, 133, 126, 255, 0, 169,
    ]);

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
    let bytes =
        data
            .get(offset..offset + 8)
            .ok_or(
                ProgramError::InvalidInstructionData
            )?;

    Ok(
        u64::from_le_bytes(
            bytes
                .try_into()
                .map_err(
                    |_| ProgramError::InvalidInstructionData
                )?
        )
    )
}

#[inline(always)]
fn fee(amount: u64) -> u64 {
    // Exactly 25 / 10,000.
    amount / 400
}

/*
 * Exact floor(a*b/d) without linking the large
 * compiler u128-division runtime.
 *
 * PumpLite calls this only when b < d.
 */
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

        let carry =
            if ar >= gap {
                ar -= gap;
                1u64
            } else {
                ar += ar;
                0u64
            };

        aq = aq
            .checked_mul(2)
            .and_then(
                |v| v.checked_add(carry)
            )
            .ok_or(err(ERR_OVERFLOW))?;
    }

    Ok(q)
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

    let f = fee(input);

    let net =
        input
            .checked_sub(f)
            .ok_or(err(ERR_OVERFLOW))?;

    let denominator =
        VIRTUAL_NATIVE
            .checked_add(native)
            .and_then(
                |v| v.checked_add(net)
            )
            .ok_or(err(ERR_OVERFLOW))?;

    let output =
        mul_div_ratio(
            tokens,
            net,
            denominator,
        )?;

    if output == 0 || output >= tokens {
        return Err(err(ERR_QUOTE));
    }

    Ok((output, f))
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

    let denominator =
        tokens
            .checked_add(input)
            .ok_or(err(ERR_OVERFLOW))?;

    let priced =
        VIRTUAL_NATIVE
            .checked_add(native)
            .ok_or(err(ERR_OVERFLOW))?;

    let gross =
        mul_div_ratio(
            priced,
            input,
            denominator,
        )?;

    if gross == 0 || gross > native {
        return Err(err(ERR_BACKING));
    }

    Ok((gross, fee(gross)))
}

#[inline(always)]
fn system_transfer(
    from: &AccountView,
    to: &AccountView,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let accounts = [
        InstructionAccount::writable_signer(
            from.address()
        ),
        InstructionAccount::writable(
            to.address()
        ),
    ];

    let mut data = [0u8; 12];

    data[0..4]
        .copy_from_slice(
            &2u32.to_le_bytes()
        );

    data[4..12]
        .copy_from_slice(
            &amount.to_le_bytes()
        );

    let instruction =
        InstructionView {
            program_id: &SYSTEM_ID,
            accounts: &accounts,
            data: &data,
        };

    if from.is_borrowed() |
       to.is_borrowed()
    {
        return Err(
            ProgramError::AccountBorrowFailed
        );
    }

    let mut cpi = [
        const {
            MaybeUninit::<CpiAccount>::uninit()
        };
        2
    ];

    CpiAccount::init_from_account_view(
        from,
        &mut cpi[0],
    );

    CpiAccount::init_from_account_view(
        to,
        &mut cpi[1],
    );

    unsafe {
        invoke_signed_unchecked(
            &instruction,
            from_raw_parts(
                cpi.as_ptr() as _,
                2
            ),
            signers,
        );
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
        InstructionAccount::writable(
            mint.address()
        ),
        InstructionAccount::writable(
            destination.address()
        ),
        InstructionAccount::readonly_signer(
            authority.address()
        ),
    ];

    let mut data = [0u8; 9];

    data[0] = 7;

    data[1..9]
        .copy_from_slice(
            &amount.to_le_bytes()
        );

    let instruction =
        InstructionView {
            program_id: &TOKEN_ID,
            accounts: &accounts,
            data: &data,
        };

    let mut cpi = [
        const {
            MaybeUninit::<CpiAccount>::uninit()
        };
        3
    ];

    CpiAccount::init_from_account_view(
        mint,
        &mut cpi[0],
    );

    CpiAccount::init_from_account_view(
        destination,
        &mut cpi[1],
    );

    CpiAccount::init_from_account_view(
        authority,
        &mut cpi[2],
    );

    unsafe {
        invoke_signed_unchecked(
            &instruction,
            from_raw_parts(
                cpi.as_ptr() as _,
                3
            ),
            signers,
        );
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
        InstructionAccount::writable(
            account.address()
        ),
        InstructionAccount::writable(
            mint.address()
        ),
        InstructionAccount::readonly_signer(
            authority.address()
        ),
    ];

    let mut data = [0u8; 9];

    data[0] = 8;

    data[1..9]
        .copy_from_slice(
            &amount.to_le_bytes()
        );

    let instruction =
        InstructionView {
            program_id: &TOKEN_ID,
            accounts: &accounts,
            data: &data,
        };

    let mut cpi = [
        const {
            MaybeUninit::<CpiAccount>::uninit()
        };
        3
    ];

    CpiAccount::init_from_account_view(
        account,
        &mut cpi[0],
    );

    CpiAccount::init_from_account_view(
        mint,
        &mut cpi[1],
    );

    CpiAccount::init_from_account_view(
        authority,
        &mut cpi[2],
    );

    unsafe {
        invoke_signed_unchecked(
            &instruction,
            from_raw_parts(
                cpi.as_ptr() as _,
                3
            ),
            &[],
        );
    }

    Ok(())
}

#[inline(always)]
fn remaining_tokens(
    mint: &AccountView,
    market: &AccountView,
) -> Result<u64, ProgramError> {
    if !mint.owned_by(&TOKEN_ID) {
        return Err(
            ProgramError::IncorrectProgramId
        );
    }

    let data =
        mint.try_borrow()?;

    if data.len() != 82 {
        return Err(
            ProgramError::InvalidAccountData
        );
    }

    if data[44] != DECIMALS ||
       data[45] != 1
    {
        return Err(err(ERR_ACCOUNT));
    }

    // Mint authority Some(market PDA).
    if data[0..4] != [1, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    if &data[4..36] !=
        market.address().as_ref()
    {
        return Err(err(ERR_ACCOUNT));
    }

    // Freeze authority permanently None.
    if data[46..50] != [0, 0, 0, 0] {
        return Err(err(ERR_ACCOUNT));
    }

    let circulating =
        u64_at(&data, 36)?;

    let remaining =
        SUPPLY
            .checked_sub(circulating)
            .ok_or(err(ERR_ACCOUNT))?;

    if remaining == 0 {
        return Err(err(ERR_QUOTE));
    }

    Ok(remaining)
}

#[inline(always)]
fn check_accounts(
    trader: &AccountView,
    treasury: &AccountView,
) -> ProgramResult {
    if !trader.is_signer() ||
       !trader.is_writable()
    {
        return Err(
            ProgramError::MissingRequiredSignature
        );
    }

    if treasury.address().as_array()
        != &TREASURY
    {
        return Err(err(ERR_ACCOUNT));
    }

    if !treasury.is_writable() {
        return Err(err(ERR_ACCOUNT));
    }

    Ok(())
}

fn buy(
    accounts: &mut [AccountView],
    input: u64,
    minimum: u64,
) -> ProgramResult {
    let [
        trader,
        market,
        mint,
        trader_tokens,
        treasury,
    ] = accounts
    else {
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    check_accounts(
        trader,
        treasury,
    )?;

    let tokens =
        remaining_tokens(
            mint,
            market,
        )?;

    let native =
        market.lamports();

    let (output, f) =
        quote_buy(
            native,
            tokens,
            input,
        )?;

    if output < minimum {
        return Err(err(ERR_SLIPPAGE));
    }

    let net =
        input
            .checked_sub(f)
            .ok_or(err(ERR_OVERFLOW))?;

    // 0.25% PumpLite fee.
    system_transfer(
        trader,
        treasury,
        f,
        &[],
    )?;

    // Curve backing.
    system_transfer(
        trader,
        market,
        net,
        &[],
    )?;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(
            mint.address().as_ref()
        ),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [
        Signer::from(&seeds)
    ];

    token_mint_to(
        mint,
        trader_tokens,
        market,
        output,
        &signers,
    )?;

    Ok(())
}

fn sell(
    accounts: &mut [AccountView],
    input: u64,
    minimum: u64,
) -> ProgramResult {
    let [
        trader,
        market,
        mint,
        trader_tokens,
        treasury,
    ] = accounts
    else {
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    check_accounts(
        trader,
        treasury,
    )?;

    let tokens =
        remaining_tokens(
            mint,
            market,
        )?;

    let native =
        market.lamports();

    let (gross, f) =
        quote_sell(
            native,
            tokens,
            input,
        )?;

    let output =
        gross
            .checked_sub(f)
            .ok_or(err(ERR_OVERFLOW))?;

    if output < minimum {
        return Err(err(ERR_SLIPPAGE));
    }

    token_burn(
        trader_tokens,
        mint,
        trader,
        input,
    )?;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(
            mint.address().as_ref()
        ),
        Seed::from(&FIXED_BUMP),
    ];

    let signers = [
        Signer::from(&seeds)
    ];

    system_transfer(
        market,
        treasury,
        f,
        &signers,
    )?;

    system_transfer(
        market,
        trader,
        output,
        &signers,
    )?;

    Ok(())
}

fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() != 17 {
        return Err(
            ProgramError::InvalidInstructionData
        );
    }

    let tag =
        instruction_data[0];

    let input =
        u64_at(
            instruction_data,
            1,
        )?;

    let minimum =
        u64_at(
            instruction_data,
            9,
        )?;

    if input == 0 {
        return Err(err(ERR_QUOTE));
    }

    if minimum == 0 {
        return Err(err(ERR_SLIPPAGE));
    }

    match tag {
        0 =>
            buy(
                accounts,
                input,
                minimum,
            ),

        1 =>
            sell(
                accounts,
                input,
                minimum,
            ),

        _ =>
            Err(
                ProgramError::InvalidInstructionData
            ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference(
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
    fn fee_is_25_bps() {
        for n in [
            1u64,
            400,
            1_000,
            1_000_000,
            1_000_000_000,
            u32::MAX as u64,
        ] {
            assert_eq!(
                fee(n),
                (
                    (n as u128) *
                    25 /
                    10_000
                ) as u64
            );
        }
    }

    #[test]
    fn compact_math_matches_reference() {
        for a in [
            1u64,
            10,
            1_000,
            1_000_000_000,
            SUPPLY,
        ] {
            for d in [
                2u64,
                31,
                1_000,
                VIRTUAL_NATIVE,
                SUPPLY,
            ] {
                let b =
                    (a % d)
                        .min(d - 1);

                assert_eq!(
                    mul_div_ratio(
                        a,
                        b,
                        d
                    )
                    .unwrap(),
                    reference(
                        a,
                        b,
                        d
                    )
                );
            }
        }
    }

    #[test]
    fn round_trip_cannot_profit() {
        for amount in [
            10_000u64,
            1_000_000,
            100_000_000,
            1_000_000_000,
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

            assert!(
                gross - sell_fee <
                amount
            );
        }
    }
}