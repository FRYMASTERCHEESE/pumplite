#![no_std]

use core::{mem::MaybeUninit, ptr::write_unaligned, slice::from_raw_parts};

use pinocchio::{
    cpi::{CpiAccount, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    no_allocator, nostd_panic_handler, program_entrypoint,
    AccountView, Address, ProgramResult,
};

#[cfg(any(target_os = "solana", target_arch = "bpf"))]
use pinocchio::syscalls::sol_invoke_signed_c;

program_entrypoint!(process_instruction);
no_allocator!();
nostd_panic_handler!();

const SUPPLY: u64 = 1_000_000_000_000_000;
const VIRTUAL: u64 = 30_000_000_000;
const MARKET_SEED: &[u8] = b"market";
const BUMP: [u8; 1] = [255];

const SYSTEM: Address = Address::new_from_array([0u8; 32]);

const TOKEN: Address = Address::new_from_array([
    6,221,246,225,215,101,161,147,
    217,203,225,70,206,235,121,172,
    28,180,133,237,95,91,55,145,
    58,140,245,133,126,255,0,169,
]);

const TREASURY: [u8; 32] = [
    154,43,125,98,46,105,90,60,
    123,243,131,172,220,232,145,114,
    51,74,179,173,201,246,100,32,
    206,139,195,141,70,179,119,97,
];

#[inline(always)]
fn bad<T>() -> Result<T, ProgramError> {
    Err(ProgramError::InvalidArgument)
}

#[inline(always)]
unsafe fn read64(p: *const u8) -> u64 {
    u64::from_le(core::ptr::read_unaligned(p as *const u64))
}
#[inline(never)]
unsafe fn invoke_cpi_checked(
    instruction: &InstructionView,
    accounts: &[CpiAccount],
    signers: &[Signer<'_, '_>],
) -> ProgramResult {
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    {
        #[repr(C)]
        struct CInstruction {
            program_id: *const Address,
            accounts: *const InstructionAccount<'static>,
            accounts_len: u64,
            data: *const u8,
            data_len: u64,
        }

        let cpi = CInstruction {
            program_id: instruction.program_id,
            accounts:
                instruction.accounts.as_ptr()
                    as *const InstructionAccount<'static>,
            accounts_len: instruction.accounts.len() as u64,
            data: instruction.data.as_ptr(),
            data_len: instruction.data.len() as u64,
        };

        core::sync::atomic::compiler_fence(
            core::sync::atomic::Ordering::SeqCst
        );

        let result = sol_invoke_signed_c(
            &cpi as *const _ as *const u8,
            accounts.as_ptr() as *const u8,
            accounts.len() as u64,
            signers.as_ptr() as *const u8,
            signers.len() as u64,
        );

        if result == 0 {
            Ok(())
        } else {
            Err(ProgramError::InvalidArgument)
        }
    }

    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    {
        core::hint::black_box((instruction, accounts, signers));
        Ok(())
    }
}

#[cfg(not(feature = "bitmul"))]
#[inline(never)]
fn md(a: u64, b: u64, d: u64) -> Result<u64, ProgramError> {
    if d == 0 { return bad(); }
    Ok((((a as u128) * (b as u128)) / (d as u128)) as u64)
}

#[cfg(feature = "bitmul")]
#[inline(never)]
fn md(a: u64, b: u64, d: u64) -> Result<u64, ProgramError> {
    if d == 0 || b >= d { return bad(); }
    let mut q = 0u64;
    let mut r = 0u64;
    let mut aq = a / d;
    let mut ar = a % d;
    let mut x = b;
    while x != 0 {
        if x & 1 != 0 {
            q = q.checked_add(aq).ok_or(ProgramError::InvalidArgument)?;
            let gap = d - ar;
            if r >= gap {
                r -= gap;
                q = q.checked_add(1).ok_or(ProgramError::InvalidArgument)?;
            } else {
                r += ar;
            }
        }
        x >>= 1;
        if x == 0 { break; }
        let gap = d - ar;
        let carry;
        if ar >= gap {
            ar -= gap;
            carry = 1;
        } else {
            ar += ar;
            carry = 0;
        }
        aq = aq.checked_mul(2)
            .and_then(|v| v.checked_add(carry))
            .ok_or(ProgramError::InvalidArgument)?;
    }
    Ok(q)
}

#[inline(never)]
fn sol_xfer(
    from: &AccountView,
    to: &AccountView,
    lamports: u64,
    signers: &[Signer<'_, '_>],
) -> ProgramResult {
    let metas = [
        InstructionAccount::writable_signer(from.address()),
        InstructionAccount::writable(to.address()),
    ];
    let mut data = [0u8; 12];
    data[0] = 2;
    unsafe {
        write_unaligned(
            data.as_mut_ptr().add(4) as *mut u64,
            lamports.to_le(),
        );
    }
    let ix = InstructionView {
        program_id: &SYSTEM,
        accounts: &metas,
        data: &data,
    };
    let mut infos = [
        const { MaybeUninit::<CpiAccount>::uninit() },
        const { MaybeUninit::<CpiAccount>::uninit() },
    ];
    CpiAccount::init_from_account_view(from, &mut infos[0]);
    CpiAccount::init_from_account_view(to, &mut infos[1]);
    unsafe {
        invoke_cpi_checked(
            &ix,
            from_raw_parts(infos.as_ptr() as _, 2),
            signers,
        )
    }
}

#[inline(never)]
fn token_xfer(
    tag: u8,
    a: &AccountView,
    b: &AccountView,
    authority: &AccountView,
    amount: u64,
    signers: &[Signer<'_, '_>],
) -> ProgramResult {
    let metas = [
        InstructionAccount::writable(a.address()),
        InstructionAccount::writable(b.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];
    let mut data = [0u8; 9];
    data[0] = tag;
    unsafe {
        write_unaligned(
            data.as_mut_ptr().add(1) as *mut u64,
            amount.to_le(),
        );
    }
    let ix = InstructionView {
        program_id: &TOKEN,
        accounts: &metas,
        data: &data,
    };
    let mut infos = [
        const { MaybeUninit::<CpiAccount>::uninit() },
        const { MaybeUninit::<CpiAccount>::uninit() },
        const { MaybeUninit::<CpiAccount>::uninit() },
    ];
    CpiAccount::init_from_account_view(a, &mut infos[0]);
    CpiAccount::init_from_account_view(b, &mut infos[1]);
    CpiAccount::init_from_account_view(authority, &mut infos[2]);
    unsafe {
        invoke_cpi_checked(
            &ix,
            from_raw_parts(infos.as_ptr() as _, 3),
            signers,
        )
    }
}

#[inline(never)]
fn remaining(mint: &AccountView, market: &AccountView) -> Result<u64, ProgramError> {
    if !mint.owned_by(&TOKEN) || mint.data_len() != 82 {
        return bad();
    }
    let d = unsafe { mint.borrow_unchecked() };
    if d[0..4] != [1,0,0,0] { return bad(); }
    if &d[4..36] != market.address().as_ref() { return bad(); }
    if d[44] != 6 || d[45] != 1 { return bad(); }
    if d[46..50] != [0,0,0,0] { return bad(); }
    let circulating = unsafe { read64(d.as_ptr().add(36)) };
    let left = SUPPLY.checked_sub(circulating).ok_or(ProgramError::InvalidArgument)?;
    if left == 0 { return bad(); }
    Ok(left)
}

#[inline(never)]
fn quote(tag: u8, native: u64, tokens: u64, input: u64) -> Result<(u64,u64), ProgramError> {
    if input == 0 || tokens == 0 { return bad(); }
    if tag == 0 {
        let fee = input / 400;
        let net = input - fee;
        let den = VIRTUAL.checked_add(native)
            .and_then(|v| v.checked_add(net))
            .ok_or(ProgramError::InvalidArgument)?;
        let out = md(tokens, net, den)?;
        if out == 0 || out >= tokens { return bad(); }
        Ok((out, fee))
    } else {
        let den = tokens.checked_add(input).ok_or(ProgramError::InvalidArgument)?;
        let priced = VIRTUAL.checked_add(native).ok_or(ProgramError::InvalidArgument)?;
        let gross = md(priced, input, den)?;
        if gross == 0 || gross > native { return bad(); }
        let fee = gross / 400;
        let out = gross - fee;
        if out == 0 { return bad(); }
        Ok((out, fee))
    }
}

#[inline(never)]
fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 17 { return bad(); }
    let tag = data[0];
    if tag > 1 { return bad(); }
    let input = unsafe { read64(data.as_ptr().add(1)) };
    let minimum = unsafe { read64(data.as_ptr().add(9)) };
    if input == 0 || minimum == 0 { return bad(); }

    if accounts.len() < 5 {
        return bad();
    }

    let p = accounts.as_ptr();

    let trader = unsafe { &*p };
    let market = unsafe { &*p.add(1) };
    let mint = unsafe { &*p.add(2) };
    let trader_tokens = unsafe { &*p.add(3) };
    let treasury = unsafe { &*p.add(4) };

    if treasury.address().as_array() != &TREASURY { return bad(); }

    let tokens = remaining(mint, market)?;
    let native = market.lamports();
    let (output, fee) = quote(tag, native, tokens, input)?;
    if output < minimum { return bad(); }

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&BUMP),
    ];
    let signers = [Signer::from(&seeds)];

    if tag == 0 {
        sol_xfer(trader, treasury, fee, &[])?;
        sol_xfer(trader, market, input - fee, &[])?;
        token_xfer(7, mint, trader_tokens, market, output, &signers)
    } else {
        token_xfer(8, trader_tokens, mint, trader, input, &[])?;
        sol_xfer(market, treasury, fee, &signers)?;
        sol_xfer(market, trader, output, &signers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ref_md(a:u64,b:u64,d:u64)->u64 {
        (((a as u128)*(b as u128))/(d as u128)) as u64
    }

    #[test]
    fn curve_matches_reference() {
        let vals=[1u64,2,7,399,400,1_000_000,30_000_000_000,1_000_000_000_000_000,u32::MAX as u64];
        for &a in &vals {
            for &d0 in &vals {
                let d=d0.max(2);
                for &b0 in &vals {
                    let b=b0%d;
                    assert_eq!(md(a,b,d).unwrap(),ref_md(a,b,d));
                }
            }
        }
    }

    #[test]
    fn roundtrip_no_profit() {
        for input in [1_000u64,1_000_000,1_000_000_000,50_000_000_000] {
            let (out,bf)=quote(0,0,SUPPLY,input).unwrap();
            let native=input-bf;
            let left=SUPPLY-out;
            let (sell,_)=quote(1,native,left,out).unwrap();
            assert!(sell<input);
        }
    }
}
