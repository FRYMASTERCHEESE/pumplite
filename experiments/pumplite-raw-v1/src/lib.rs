#![no_std]

use core::{
    mem::size_of,
    ptr::{read_unaligned, write_unaligned},
};

#[cfg(any(target_os = "solana", target_arch = "bpf"))]
use solana_define_syscall::definitions::sol_invoke_signed_c;

type Address = [u8; 32];

const SUPPLY: u64 = 1_000_000_000_000_000;
const VIRTUAL: u64 = 30_000_000_000;

const SYSTEM: Address = [0; 32];

const TOKEN: Address = [
    6,221,246,225,215,101,161,147,
    217,203,225,70,206,235,121,172,
    28,180,133,237,95,91,55,145,
    58,140,245,133,126,255,0,169,
];

const TREASURY: Address = [
    154,43,125,98,46,105,90,60,
    123,243,131,172,220,232,145,114,
    51,74,179,173,201,246,100,32,
    206,139,195,141,70,179,119,97,
];

const MARKET: &[u8; 6] = b"market";

#[repr(C)]
struct RawAccount {
    borrow_state: u8,
    is_signer: u8,
    is_writable: u8,
    executable: u8,
    padding: [u8; 4],
    address: Address,
    owner: Address,
    lamports: u64,
    data_len: u64,
}

#[repr(C)]
struct Meta {
    address: *const Address,
    writable: u8,
    signer: u8,
}

#[repr(C)]
struct CpiAccount {
    address: *const Address,
    lamports: *const u64,
    data_len: u64,
    data: *const u8,
    owner: *const Address,
    rent_epoch: u64,
    signer: u8,
    writable: u8,
    executable: u8,
    padding: u8,
}

#[repr(C)]
struct CInstruction {
    program: *const Address,
    accounts: *const Meta,
    accounts_len: u64,
    data: *const u8,
    data_len: u64,
}

#[repr(C)]
struct Seed {
    data: *const u8,
    len: u64,
}

#[repr(C)]
struct Signer {
    seeds: *const Seed,
    len: u64,
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    unsafe { core::hint::unreachable_unchecked() }
}

#[inline(always)]
unsafe fn u64at(p: *const u8) -> u64 {
    u64::from_le(read_unaligned(p as *const u64))
}

#[inline(always)]
unsafe fn eq32(a: *const u8, b: *const u8) -> bool {
    read_unaligned(a as *const u64)
        == read_unaligned(b as *const u64)
        &&
    read_unaligned(a.add(8) as *const u64)
        == read_unaligned(b.add(8) as *const u64)
        &&
    read_unaligned(a.add(16) as *const u64)
        == read_unaligned(b.add(16) as *const u64)
        &&
    read_unaligned(a.add(24) as *const u64)
        == read_unaligned(b.add(24) as *const u64)
}

#[inline(always)]
unsafe fn info(a: *const RawAccount) -> CpiAccount {
    CpiAccount {
        address: &(*a).address,
        lamports: &(*a).lamports,
        data_len: (*a).data_len,
        data: a.add(1) as *const u8,
        owner: &(*a).owner,
        rent_epoch: 0,
        signer: (*a).is_signer,
        writable: (*a).is_writable,
        executable: (*a).executable,
        padding: 0,
    }
}

/*
 floor(a*b/d), with b < d.
 Same overflow-safe arithmetic used by the verified PumpLite core.
*/
#[inline(always)]
fn md(a: u64, b: u64, d: u64) -> u64 {
    if d == 0 || b >= d {
        return u64::MAX;
    }

    let mut q = 0u64;
    let mut r = 0u64;
    let mut aq = a / d;
    let mut ar = a % d;
    let mut x = b;

    while x != 0 {
        if x & 1 != 0 {
            q = match q.checked_add(aq) {
                Some(v) => v,
                None => return u64::MAX,
            };

            let gap = d - ar;

            if r >= gap {
                r -= gap;

                q = match q.checked_add(1) {
                    Some(v) => v,
                    None => return u64::MAX,
                };
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
            carry = 1;
        } else {
            ar += ar;
            carry = 0;
        }

        aq = match aq
            .checked_mul(2)
            .and_then(|v| v.checked_add(carry))
        {
            Some(v) => v,
            None => return u64::MAX,
        };
    }

    q
}

#[inline(always)]
unsafe fn invoke(
    program: *const Address,
    metas: *const Meta,
    meta_len: u64,
    infos: *const CpiAccount,
    info_len: u64,
    data: *const u8,
    data_len: u64,
    signers: *const Signer,
    signer_len: u64,
) -> u64 {
    let ix = CInstruction {
        program,
        accounts: metas,
        accounts_len: meta_len,
        data,
        data_len,
    };

    core::sync::atomic::compiler_fence(
        core::sync::atomic::Ordering::SeqCst
    );

    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    {
        sol_invoke_signed_c(
            &ix as *const _ as *const u8,
            infos as *const u8,
            info_len,
            signers as *const u8,
            signer_len,
        )
    }

    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    {
        let _ = (
            ix,
            infos,
            info_len,
            signers,
            signer_len,
        );
        0
    }
}

#[inline(always)]
unsafe fn sol_transfer(
    from: *const RawAccount,
    to: *const RawAccount,
    amount: u64,
    signer: *const Signer,
    signer_len: u64,
) -> u64 {
    let metas = [
        Meta {
            address: &(*from).address,
            writable: 1,
            signer: 1,
        },
        Meta {
            address: &(*to).address,
            writable: 1,
            signer: 0,
        },
    ];

    let infos = [
        info(from),
        info(to),
    ];

    let mut data = [0u8; 12];

    data[0] = 2;

    write_unaligned(
        data.as_mut_ptr().add(4) as *mut u64,
        amount.to_le(),
    );

    invoke(
        &SYSTEM,
        metas.as_ptr(),
        2,
        infos.as_ptr(),
        2,
        data.as_ptr(),
        12,
        signer,
        signer_len,
    )
}

#[inline(always)]
unsafe fn token(
    tag: u8,
    a: *const RawAccount,
    b: *const RawAccount,
    authority: *const RawAccount,
    amount: u64,
    signer: *const Signer,
    signer_len: u64,
) -> u64 {
    let metas = [
        Meta {
            address: &(*a).address,
            writable: 1,
            signer: 0,
        },
        Meta {
            address: &(*b).address,
            writable: 1,
            signer: 0,
        },
        Meta {
            address: &(*authority).address,
            writable: 0,
            signer: 1,
        },
    ];

    let infos = [
        info(a),
        info(b),
        info(authority),
    ];

    let mut data = [0u8; 9];

    data[0] = tag;

    write_unaligned(
        data.as_mut_ptr().add(1) as *mut u64,
        amount.to_le(),
    );

    invoke(
        &TOKEN,
        metas.as_ptr(),
        3,
        infos.as_ptr(),
        3,
        data.as_ptr(),
        9,
        signer,
        signer_len,
    )
}

#[no_mangle]
pub unsafe extern "C" fn entrypoint(
    program_input: *mut u8,
    instruction_data: *mut u8,
) -> u64 {
    /*
      Recent Pinocchio/Agave entrypoint ABI:
      program_input begins with account count.
      Account pointers are supplied directly after
      instruction_data + program id, 8-byte aligned.
    */

    let count =
        read_unaligned(program_input as *const u64);

    if count < 7 {
        return 1;
    }

    let data_len =
        read_unaligned(
            instruction_data.sub(8) as *const u64
        ) as usize;

    if data_len != 17 {
        return 1;
    }

    let tag = *instruction_data;

    if tag > 1 {
        return 1;
    }

    let input =
        u64at(instruction_data.add(1));

    let minimum =
        u64at(instruction_data.add(9));

    if input == 0 || minimum == 0 {
        return 1;
    }

    let after_program =
        instruction_data
            .add(data_len)
            .add(32) as usize;

    let ptrs =
        ((after_program + 7) & !7)
            as *const *const RawAccount;

    let trader = *ptrs;
    let market = *ptrs.add(1);
    let mint = *ptrs.add(2);
    let trader_tokens = *ptrs.add(3);
    let treasury = *ptrs.add(4);

    if !eq32(
        (*treasury).address.as_ptr(),
        TREASURY.as_ptr(),
    ) {
        return 1;
    }

    if (*mint).data_len != 82 {
        return 1;
    }

    if !eq32(
        (*mint).owner.as_ptr(),
        TOKEN.as_ptr(),
    ) {
        return 1;
    }

    let mint_data =
        mint.add(1) as *const u8;

    if read_unaligned(
        mint_data as *const u32
    ) != 1 {
        return 1;
    }

    if !eq32(
        mint_data.add(4),
        (*market).address.as_ptr(),
    ) {
        return 1;
    }

    if *mint_data.add(44) != 6 ||
       *mint_data.add(45) != 1 ||
       read_unaligned(
           mint_data.add(46) as *const u32
       ) != 0
    {
        return 1;
    }

    let circulating =
        u64at(mint_data.add(36));

    if circulating >= SUPPLY {
        return 1;
    }

    let tokens = SUPPLY - circulating;
    let native = (*market).lamports;

    let fee;
    let output;

    if tag == 0 {
        fee = input / 400;

        let net = input - fee;

        let priced =
            match VIRTUAL
                .checked_add(native)
                .and_then(|v| v.checked_add(net))
            {
                Some(v) => v,
                None => return 1,
            };

        output = md(tokens, net, priced);

        if output == 0 ||
           output == u64::MAX ||
           output >= tokens ||
           output < minimum
        {
            return 1;
        }
    } else {
        let den =
            match tokens.checked_add(input) {
                Some(v) => v,
                None => return 1,
            };

        let priced =
            match VIRTUAL.checked_add(native) {
                Some(v) => v,
                None => return 1,
            };

        let gross = md(priced, input, den);

        if gross == 0 ||
           gross == u64::MAX ||
           gross > native
        {
            return 1;
        }

        fee = gross / 400;
        output = gross - fee;

        if output == 0 ||
           output < minimum
        {
            return 1;
        }
    }

    let bump = [255u8];

    let seeds = [
        Seed {
            data: MARKET.as_ptr(),
            len: 6,
        },
        Seed {
            data: (*mint).address.as_ptr(),
            len: 32,
        },
        Seed {
            data: bump.as_ptr(),
            len: 1,
        },
    ];

    let signer = Signer {
        seeds: seeds.as_ptr(),
        len: 3,
    };

    if tag == 0 {
        let mut rc = sol_transfer(
            trader,
            treasury,
            fee,
            core::ptr::null(),
            0,
        );

        if rc != 0 {
            return rc;
        }

        rc = sol_transfer(
            trader,
            market,
            input - fee,
            core::ptr::null(),
            0,
        );

        if rc != 0 {
            return rc;
        }

        token(
            7,
            mint,
            trader_tokens,
            market,
            output,
            &signer,
            1,
        )
    } else {
        let mut rc = token(
            8,
            trader_tokens,
            mint,
            trader,
            input,
            core::ptr::null(),
            0,
        );

        if rc != 0 {
            return rc;
        }

        rc = sol_transfer(
            market,
            treasury,
            fee,
            &signer,
            1,
        );

        if rc != 0 {
            return rc;
        }

        sol_transfer(
            market,
            trader,
            output,
            &signer,
            1,
        )
    }
}