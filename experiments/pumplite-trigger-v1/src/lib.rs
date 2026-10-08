#![no_std]

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    no_allocator,
    nostd_panic_handler,
    program_entrypoint,
    sysvars::{
        clock::Clock,
        slot_hashes::SlotHashes,
        Sysvar,
    },
    AccountView,
    Address,
    ProgramResult,
};

use pinocchio_system::instructions::{
    CreateAccount,
    Transfer as SolTransfer,
};

use pinocchio_token::instructions::{
    Burn,
    MintTo,
};

program_entrypoint!(process_instruction, 6);
no_allocator!();
nostd_panic_handler!();

const SUPPLY: u64 =
    1_000_000_000_000_000;

const VIRTUAL_NATIVE: u64 =
    30_000_000_000;

const DECIMALS: u8 = 6;

const MARKET_SEED: &[u8] =
    b"market";

const TRIGGER_SEED: &[u8] =
    b"trigger";

const FIXED_BUMP: [u8; 1] =
    [255];

const TRIGGER_SECONDS: i64 =
    24 * 60 * 60;

const MIN_INTERVAL_SECONDS: i64 =
    15;

const MAX_AGENT_TRADES: u16 =
    256;

// Conservative V1 agent limits.
// These are immutable protocol caps.
const MIN_AGENT_BUY: u64 =
    100_000;       // 0.0001 SOL

const MAX_AGENT_BUY: u64 =
    2_000_000;     // 0.002 SOL

const MAX_AGENT_NATIVE_IN: u64 =
    50_000_000;    // 0.05 SOL

const MAX_AGENT_NATIVE_OUT: u64 =
    50_000_000;    // 0.05 SOL

const MIN_SELL_BPS: u64 =
    500;           // 5%

const MAX_SELL_BPS: u64 =
    2_000;         // 20%

// Existing PumpLite treasury.
// User trades retain the existing 0.25% fee.
// Trigger-agent trades are fee-free and separately identifiable.
const TREASURY: [u8; 32] = [
    154, 43, 125, 98, 46, 105, 90, 60,
    123, 243, 131, 172, 220, 232, 145, 114,
    51, 74, 179, 173, 201, 246, 100, 32,
    206, 139, 195, 141, 70, 179, 119, 97,
];


// ------------------------------------------------------------
// Trigger-state layout
// ------------------------------------------------------------
//
// 0..4     magic
// 4        version
// 5        PDA bump
// 6        mode: 1 = Trigger
// 7        flags
// 8..40    creator
// 40..72   controller / agent wallet
// 72..104  mint
// 104..112 started unix timestamp
// 112..120 expiry unix timestamp
// 120..128 request slot
// 128..136 request nonce
// 136..144 last agent trade unix timestamp
// 144..152 total agent SOL in
// 152..160 total agent SOL out
// 160..162 trade count
// 162..168 reserved
// 168..200 creator entropy for pending request

const STATE_LEN: usize = 200;

const MAGIC: &[u8; 4] = b"PLTG";

const OFF_VERSION: usize = 4;
const OFF_BUMP: usize = 5;
const OFF_MODE: usize = 6;
const OFF_FLAGS: usize = 7;

const OFF_CREATOR: usize = 8;
const OFF_CONTROLLER: usize = 40;
const OFF_MINT: usize = 72;

const OFF_STARTED: usize = 104;
const OFF_EXPIRES: usize = 112;
const OFF_REQUEST_SLOT: usize = 120;
const OFF_REQUEST_NONCE: usize = 128;
const OFF_LAST_TRADE: usize = 136;
const OFF_AGENT_IN: usize = 144;
const OFF_AGENT_OUT: usize = 152;
const OFF_TRADE_COUNT: usize = 160;
const OFF_ENTROPY: usize = 168;

const FLAG_PENDING: u8 = 1;

const MODE_TRIGGER: u8 = 1;


// ------------------------------------------------------------
// Error codes
// ------------------------------------------------------------

const ERR_QUOTE: u32 = 6000;
const ERR_SLIPPAGE: u32 = 6001;
const ERR_ACCOUNT: u32 = 6002;
const ERR_BACKING: u32 = 6003;
const ERR_OVERFLOW: u32 = 6004;

const ERR_TRIGGER_STATE: u32 = 6100;
const ERR_TRIGGER_AUTH: u32 = 6101;
const ERR_TRIGGER_EXPIRED: u32 = 6102;
const ERR_TRIGGER_PENDING: u32 = 6103;
const ERR_TRIGGER_REQUIRED: u32 = 6104;
const ERR_TRIGGER_EARLY: u32 = 6105;
const ERR_TRIGGER_INTERVAL: u32 = 6106;
const ERR_TRIGGER_LIMIT: u32 = 6107;


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
            .ok_or(ProgramError::InvalidInstructionData)?;

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
fn i64_at(
    data: &[u8],
    offset: usize,
) -> Result<i64, ProgramError> {
    let bytes =
        data
            .get(offset..offset + 8)
            .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(
        i64::from_le_bytes(
            bytes
                .try_into()
                .map_err(
                    |_| ProgramError::InvalidInstructionData
                )?
        )
    )
}


#[inline(always)]
fn u16_at(
    data: &[u8],
    offset: usize,
) -> Result<u16, ProgramError> {
    let bytes =
        data
            .get(offset..offset + 2)
            .ok_or(ProgramError::InvalidInstructionData)?;

    Ok(
        u16::from_le_bytes(
            bytes
                .try_into()
                .map_err(
                    |_| ProgramError::InvalidInstructionData
                )?
        )
    )
}


#[inline(always)]
fn put_u64(
    data: &mut [u8],
    offset: usize,
    value: u64,
) {
    data[offset..offset + 8]
        .copy_from_slice(
            &value.to_le_bytes()
        );
}


#[inline(always)]
fn put_i64(
    data: &mut [u8],
    offset: usize,
    value: i64,
) {
    data[offset..offset + 8]
        .copy_from_slice(
            &value.to_le_bytes()
        );
}


#[inline(always)]
fn put_u16(
    data: &mut [u8],
    offset: usize,
    value: u16,
) {
    data[offset..offset + 2]
        .copy_from_slice(
            &value.to_le_bytes()
        );
}


// Exact floor(a*b/d), avoiding u128 runtime division.
//
// PumpLite only calls this when b < d.
#[inline(never)]
fn mul_div_ratio(
    a: u64,
    b: u64,
    d: u64,
) -> Result<u64, ProgramError> {
    if d == 0 || b >= d {
        return Err(
            err(ERR_OVERFLOW)
        );
    }

    let mut q = 0u64;
    let mut r = 0u64;

    let mut aq = a / d;
    let mut ar = a % d;
    let mut x = b;

    while x != 0 {
        if x & 1 != 0 {
            q =
                q.checked_add(aq)
                    .ok_or(
                        err(ERR_OVERFLOW)
                    )?;

            let gap = d - ar;

            if r >= gap {
                r -= gap;

                q =
                    q.checked_add(1)
                        .ok_or(
                            err(ERR_OVERFLOW)
                        )?;
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

        aq =
            aq.checked_mul(2)
                .and_then(
                    |value|
                        value.checked_add(
                            carry
                        )
                )
                .ok_or(
                    err(ERR_OVERFLOW)
                )?;
    }

    Ok(q)
}


// Existing PumpLite user fee:
// 25 / 10,000 = 1 / 400.
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
        return Err(
            err(ERR_QUOTE)
        );
    }

    let fees = fee(input);

    let net =
        input
            .checked_sub(fees)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let denominator =
        VIRTUAL_NATIVE
            .checked_add(native)
            .and_then(
                |value|
                    value.checked_add(net)
            )
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let output =
        mul_div_ratio(
            tokens,
            net,
            denominator,
        )?;

    if output == 0 ||
       output >= tokens {
        return Err(
            err(ERR_QUOTE)
        );
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
        return Err(
            err(ERR_QUOTE)
        );
    }

    let denominator =
        tokens
            .checked_add(input)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let priced =
        VIRTUAL_NATIVE
            .checked_add(native)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let gross =
        mul_div_ratio(
            priced,
            input,
            denominator,
        )?;

    if gross == 0 ||
       gross > native {
        return Err(
            err(ERR_BACKING)
        );
    }

    Ok(
        (
            gross,
            fee(gross)
        )
    )
}


// Trigger-agent trades pay no PumpLite user fee.
// They are identified by instruction tag 4.
#[inline(always)]
fn quote_agent_buy(
    native: u64,
    tokens: u64,
    input: u64,
) -> Result<u64, ProgramError> {
    if input == 0 || tokens == 0 {
        return Err(
            err(ERR_QUOTE)
        );
    }

    let denominator =
        VIRTUAL_NATIVE
            .checked_add(native)
            .and_then(
                |value|
                    value.checked_add(input)
            )
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let output =
        mul_div_ratio(
            tokens,
            input,
            denominator,
        )?;

    if output == 0 ||
       output >= tokens {
        return Err(
            err(ERR_QUOTE)
        );
    }

    Ok(output)
}


#[inline(always)]
fn quote_agent_sell(
    native: u64,
    tokens: u64,
    input: u64,
) -> Result<u64, ProgramError> {
    if input == 0 || tokens == 0 {
        return Err(
            err(ERR_QUOTE)
        );
    }

    let denominator =
        tokens
            .checked_add(input)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let priced =
        VIRTUAL_NATIVE
            .checked_add(native)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let gross =
        mul_div_ratio(
            priced,
            input,
            denominator,
        )?;

    if gross == 0 ||
       gross > native {
        return Err(
            err(ERR_BACKING)
        );
    }

    Ok(gross)
}


// Current mint supply is circulating supply.
// 1B - circulating = remaining curve inventory.
#[inline(always)]
fn remaining_tokens(
    mint: &AccountView,
    market: &AccountView,
) -> Result<u64, ProgramError> {
    if !mint.owned_by(
        &pinocchio_token::ID
    ) {
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
       data[45] != 1 {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    if data[0..4] !=
       [1, 0, 0, 0] {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    if &data[4..36] !=
       market.address().as_ref() {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    if data[46..50] !=
       [0, 0, 0, 0] {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    let circulating =
        u64_at(
            &data,
            36
        )?;

    let remaining =
        SUPPLY
            .checked_sub(circulating)
            .ok_or(
                err(ERR_ACCOUNT)
            )?;

    if remaining == 0 {
        return Err(
            err(ERR_QUOTE)
        );
    }

    Ok(remaining)
}


fn validate_creation_mint(
    mint: &AccountView,
    expected_market: &Address,
) -> ProgramResult {
    if !mint.owned_by(
        &pinocchio_token::ID
    ) {
        return Err(
            ProgramError::IncorrectProgramId
        );
    }

    let data =
        mint.try_borrow()?;

    if data.len() != 82 ||
       data[44] != DECIMALS ||
       data[45] != 1 {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    if data[0..4] !=
       [1, 0, 0, 0] {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    if &data[4..36] !=
       expected_market.as_ref() {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    if data[46..50] !=
       [0, 0, 0, 0] {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    // Trigger must be selected at creation,
    // before anyone has bought.
    if u64_at(
        &data,
        36
    )? != 0 {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    Ok(())
}


#[inline(always)]
fn check_treasury(
    treasury: &AccountView,
) -> ProgramResult {
    if treasury.address().as_array() !=
       &TREASURY {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    Ok(())
}


fn verify_trigger_state(
    program_id: &Address,
    state: &AccountView,
) -> ProgramResult {
    if !state.owned_by(program_id) ||
       state.data_len() != STATE_LEN {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    let data =
        state.try_borrow()?;

    if &data[0..4] != MAGIC ||
       data[OFF_VERSION] != 1 ||
       data[OFF_MODE] != MODE_TRIGGER {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    let bump =
        data[OFF_BUMP];

    let expected =
        Address::create_program_address(
            &[
                TRIGGER_SEED,
                &data[
                    OFF_MINT..
                    OFF_MINT + 32
                ],
                &[bump],
            ],
            program_id,
        )
        .map_err(
            |_| err(ERR_TRIGGER_STATE)
        )?;

    if state.address() !=
       &expected {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    Ok(())
}


fn agent_token_balance(
    account: &AccountView,
    mint: &Address,
    owner: &Address,
) -> Result<u64, ProgramError> {
    if !account.owned_by(
        &pinocchio_token::ID
    ) {
        return Err(
            ProgramError::IncorrectProgramId
        );
    }

    let data =
        account.try_borrow()?;

    if data.len() != 165 {
        return Err(
            ProgramError::InvalidAccountData
        );
    }

    if &data[0..32] !=
       mint.as_ref() ||
       &data[32..64] !=
       owner.as_ref() {
        return Err(
            err(ERR_TRIGGER_AUTH)
        );
    }

    u64_at(
        &data,
        64
    )
}


fn random_buy_amount(
    hash: &[u8; 32],
    entropy: &[u8; 32],
) -> u64 {
    let raw =
        u64::from_le_bytes([
            hash[1] ^ entropy[1],
            hash[2] ^ entropy[2],
            hash[3] ^ entropy[3],
            hash[4] ^ entropy[4],
            hash[5] ^ entropy[5],
            hash[6] ^ entropy[6],
            hash[7] ^ entropy[7],
            hash[8] ^ entropy[8],
        ]);

    MIN_AGENT_BUY +
        (
            raw %
            (
                MAX_AGENT_BUY -
                MIN_AGENT_BUY +
                1
            )
        )
}


fn random_sell_bps(
    hash: &[u8; 32],
    entropy: &[u8; 32],
) -> u64 {
    let raw =
        u16::from_le_bytes([
            hash[9] ^ entropy[9],
            hash[10] ^ entropy[10],
        ]) as u64;

    MIN_SELL_BPS +
        (
            raw %
            (
                MAX_SELL_BPS -
                MIN_SELL_BPS +
                1
            )
        )
}


// ------------------------------------------------------------
// Existing real PumpLite user BUY
// ------------------------------------------------------------

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
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    check_treasury(treasury)?;

    let tokens =
        remaining_tokens(
            mint,
            market,
        )?;

    let native =
        market.lamports();

    let (output, fees) =
        quote_buy(
            native,
            tokens,
            input,
        )?;

    if output <
       minimum_output {
        return Err(
            err(ERR_SLIPPAGE)
        );
    }

    let net =
        input
            .checked_sub(fees)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

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

    let bump =
        FIXED_BUMP;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(
            mint.address().as_ref()
        ),
        Seed::from(&bump),
    ];

    let signers = [
        Signer::from(&seeds)
    ];

    MintTo::new(
        mint,
        trader_tokens,
        market,
        output,
    )
    .invoke_signed(
        &signers
    )?;

    Ok(())
}


// ------------------------------------------------------------
// Existing real PumpLite user SELL
// ------------------------------------------------------------

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
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    check_treasury(treasury)?;

    let tokens =
        remaining_tokens(
            mint,
            market,
        )?;

    let native =
        market.lamports();

    let (gross, fees) =
        quote_sell(
            native,
            tokens,
            input,
        )?;

    let output =
        gross
            .checked_sub(fees)
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    if output <
       minimum_output {
        return Err(
            err(ERR_SLIPPAGE)
        );
    }

    Burn::new(
        trader_tokens,
        mint,
        trader,
        input,
    )
    .invoke()?;

    let bump =
        FIXED_BUMP;

    let seeds = [
        Seed::from(MARKET_SEED),
        Seed::from(
            mint.address().as_ref()
        ),
        Seed::from(&bump),
    ];

    let signers = [
        Signer::from(&seeds)
    ];

    SolTransfer {
        from: market,
        to: treasury,
        lamports: fees,
    }
    .invoke_signed(
        &signers
    )?;

    SolTransfer {
        from: market,
        to: trader,
        lamports: output,
    }
    .invoke_signed(
        &signers
    )?;

    Ok(())
}


// ------------------------------------------------------------
// TAG 2
// Enable Trigger at coin creation.
// ------------------------------------------------------------
//
// Accounts:
// 0 creator/payer   writable signer
// 1 trigger state   writable PDA
// 2 mint            readonly
//
// Data:
// 2 | bump | controller[32]
//
// This is only valid while mint supply == 0.
// Therefore Trigger cannot be switched on later.

fn initialize_trigger(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 34 ||
       data[0] != 2 {
        return Err(
            ProgramError::InvalidInstructionData
        );
    }

    let [
        creator,
        state,
        mint,
    ] = accounts
    else {
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    if !creator.is_signer() ||
       !creator.is_writable() ||
       !state.is_writable() {
        return Err(
            err(ERR_TRIGGER_AUTH)
        );
    }

    if !state.is_data_empty() ||
       state.lamports() != 0 {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    let bump =
        data[1];

    let controller =
        &data[2..34];

    if controller.iter().all(
        |byte| *byte == 0
    ) {
        return Err(
            err(ERR_TRIGGER_AUTH)
        );
    }

    let market =
        Address::create_program_address(
            &[
                MARKET_SEED,
                mint.address().as_ref(),
                &FIXED_BUMP,
            ],
            program_id,
        )
        .map_err(
            |_| err(ERR_ACCOUNT)
        )?;

    validate_creation_mint(
        mint,
        &market,
    )?;

    let expected_state =
        Address::create_program_address(
            &[
                TRIGGER_SEED,
                mint.address().as_ref(),
                &[bump],
            ],
            program_id,
        )
        .map_err(
            |_| err(ERR_TRIGGER_STATE)
        )?;

    if state.address() !=
       &expected_state {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    let bump_seed =
        [bump];

    let seeds = [
        Seed::from(TRIGGER_SEED),
        Seed::from(
            mint.address().as_ref()
        ),
        Seed::from(
            &bump_seed
        ),
    ];

    let signers = [
        Signer::from(
            &seeds
        )
    ];

    CreateAccount::with_minimum_balance(
        creator,
        state,
        STATE_LEN as u64,
        program_id,
        None,
    )?
    .invoke_signed(
        &signers
    )?;

    let clock =
        Clock::get()?;

    let expiry =
        clock
            .unix_timestamp
            .checked_add(
                TRIGGER_SECONDS
            )
            .ok_or(
                err(ERR_OVERFLOW)
            )?;

    let mut state_data =
        state.try_borrow_mut()?;

    state_data.fill(0);

    state_data[0..4]
        .copy_from_slice(
            MAGIC
        );

    state_data[OFF_VERSION] =
        1;

    state_data[OFF_BUMP] =
        bump;

    state_data[OFF_MODE] =
        MODE_TRIGGER;

    state_data[OFF_FLAGS] =
        0;

    state_data[
        OFF_CREATOR..
        OFF_CREATOR + 32
    ]
    .copy_from_slice(
        creator
            .address()
            .as_ref()
    );

    state_data[
        OFF_CONTROLLER..
        OFF_CONTROLLER + 32
    ]
    .copy_from_slice(
        controller
    );

    state_data[
        OFF_MINT..
        OFF_MINT + 32
    ]
    .copy_from_slice(
        mint.address().as_ref()
    );

    put_i64(
        &mut state_data,
        OFF_STARTED,
        clock.unix_timestamp,
    );

    put_i64(
        &mut state_data,
        OFF_EXPIRES,
        expiry,
    );

    Ok(())
}


// ------------------------------------------------------------
// TAG 3
// Creator fires one Trigger request.
// ------------------------------------------------------------
//
// Accounts:
// 0 creator       readonly signer
// 1 trigger state writable
//
// Data:
// 3 | creator_entropy[32]
//
// Creator entropy is combined with a future Solana slot hash.
// The future slot hash does not exist when the creator requests
// the trade, so the creator cannot know the final direction/size.

fn request_trigger(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 33 ||
       data[0] != 3 {
        return Err(
            ProgramError::InvalidInstructionData
        );
    }

    let [
        creator,
        state,
    ] = accounts
    else {
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    if !creator.is_signer() ||
       !state.is_writable() {
        return Err(
            err(ERR_TRIGGER_AUTH)
        );
    }

    verify_trigger_state(
        program_id,
        state,
    )?;

    let clock =
        Clock::get()?;

    {
        let current =
            state.try_borrow()?;

        if &current[
            OFF_CREATOR..
            OFF_CREATOR + 32
        ] !=
           creator.address().as_ref() {
            return Err(
                err(ERR_TRIGGER_AUTH)
            );
        }

        let expiry =
            i64_at(
                &current,
                OFF_EXPIRES,
            )?;

        if clock.unix_timestamp >=
           expiry {
            return Err(
                err(ERR_TRIGGER_EXPIRED)
            );
        }

        if current[OFF_FLAGS] &
           FLAG_PENDING != 0 {
            return Err(
                err(ERR_TRIGGER_PENDING)
            );
        }

        let count =
            u16_at(
                &current,
                OFF_TRADE_COUNT,
            )?;

        if count >=
           MAX_AGENT_TRADES {
            return Err(
                err(ERR_TRIGGER_LIMIT)
            );
        }
    }

    let mut current =
        state.try_borrow_mut()?;

    let nonce =
        u64_at(
            &current,
            OFF_REQUEST_NONCE,
        )?
        .checked_add(1)
        .ok_or(
            err(ERR_OVERFLOW)
        )?;

    current[OFF_FLAGS] |=
        FLAG_PENDING;

    put_u64(
        &mut current,
        OFF_REQUEST_SLOT,
        clock.slot,
    );

    put_u64(
        &mut current,
        OFF_REQUEST_NONCE,
        nonce,
    );

    current[
        OFF_ENTROPY..
        OFF_ENTROPY + 32
    ]
    .copy_from_slice(
        &data[1..33]
    );

    Ok(())
}


// ------------------------------------------------------------
// TAG 4
// Real randomized Trigger-agent trade.
// ------------------------------------------------------------
//
// Accounts:
// 0 controller / agent wallet   writable signer
// 1 trigger state               writable
// 2 market PDA                  writable
// 3 mint                        writable
// 4 controller token account    writable
// 5 SlotHashes sysvar           readonly
//
// The program itself determines buy/sell and amount using
// the first available Solana slot hash AFTER the creator's
// Trigger request.
//
// Agent buys/sells are real curve transactions.
// No fake balance or simulated price movement is used.

fn execute_trigger(
    program_id: &Address,
    accounts: &mut [AccountView],
) -> ProgramResult {
    let [
        controller,
        state,
        market,
        mint,
        controller_tokens,
        slot_hashes_account,
    ] = accounts
    else {
        return Err(
            ProgramError::NotEnoughAccountKeys
        );
    };

    if !controller.is_signer() ||
       !controller.is_writable() ||
       !state.is_writable() ||
       !market.is_writable() ||
       !mint.is_writable() ||
       !controller_tokens.is_writable() {
        return Err(
            err(ERR_TRIGGER_AUTH)
        );
    }

    verify_trigger_state(
        program_id,
        state,
    )?;

    let (
        controller_key,
        mint_key,
        expiry,
        request_slot,
        last_trade_at,
        agent_in,
        agent_out,
        trade_count,
        entropy,
    ) = {
        let current =
            state.try_borrow()?;

        if current[OFF_FLAGS] &
           FLAG_PENDING == 0 {
            return Err(
                err(ERR_TRIGGER_REQUIRED)
            );
        }

        let mut controller_key =
            [0u8; 32];

        controller_key
            .copy_from_slice(
                &current[
                    OFF_CONTROLLER..
                    OFF_CONTROLLER + 32
                ]
            );

        let mut mint_key =
            [0u8; 32];

        mint_key
            .copy_from_slice(
                &current[
                    OFF_MINT..
                    OFF_MINT + 32
                ]
            );

        let mut entropy =
            [0u8; 32];

        entropy
            .copy_from_slice(
                &current[
                    OFF_ENTROPY..
                    OFF_ENTROPY + 32
                ]
            );

        (
            controller_key,
            mint_key,
            i64_at(
                &current,
                OFF_EXPIRES,
            )?,
            u64_at(
                &current,
                OFF_REQUEST_SLOT,
            )?,
            i64_at(
                &current,
                OFF_LAST_TRADE,
            )?,
            u64_at(
                &current,
                OFF_AGENT_IN,
            )?,
            u64_at(
                &current,
                OFF_AGENT_OUT,
            )?,
            u16_at(
                &current,
                OFF_TRADE_COUNT,
            )?,
            entropy,
        )
    };

    if controller.address().as_ref() !=
       controller_key.as_slice() {
        return Err(
            err(ERR_TRIGGER_AUTH)
        );
    }

    if mint.address().as_ref() !=
       mint_key.as_slice() {
        return Err(
            err(ERR_TRIGGER_STATE)
        );
    }

    let expected_market =
        Address::create_program_address(
            &[
                MARKET_SEED,
                mint.address().as_ref(),
                &FIXED_BUMP,
            ],
            program_id,
        )
        .map_err(
            |_| err(ERR_ACCOUNT)
        )?;

    if market.address() !=
       &expected_market {
        return Err(
            err(ERR_ACCOUNT)
        );
    }

    let clock =
        Clock::get()?;

    if clock.unix_timestamp >=
       expiry {
        return Err(
            err(ERR_TRIGGER_EXPIRED)
        );
    }

    if trade_count >=
       MAX_AGENT_TRADES {
        return Err(
            err(ERR_TRIGGER_LIMIT)
        );
    }

    if last_trade_at != 0 {
        let next_allowed =
            last_trade_at
                .checked_add(
                    MIN_INTERVAL_SECONDS
                )
                .ok_or(
                    err(ERR_OVERFLOW)
                )?;

        if clock.unix_timestamp <
           next_allowed {
            return Err(
                err(ERR_TRIGGER_INTERVAL)
            );
        }
    }

    let slot_hashes =
        SlotHashes::from_account_view(
            slot_hashes_account
        )?;

    let mut chosen_hash:
        Option<[u8; 32]> =
        None;

    // Pick the first produced slot after the request.
    // Looking across 32 slots safely tolerates skipped slots.
    let mut delta =
        1u64;

    while delta <= 32 {
        let target =
            request_slot
                .checked_add(delta)
                .ok_or(
                    err(ERR_OVERFLOW)
                )?;

        if let Some(hash) =
            slot_hashes.get_hash(
                target
            ) {
            chosen_hash =
                Some(*hash);

            break;
        }

        delta += 1;
    }

    let hash =
        chosen_hash.ok_or(
            err(ERR_TRIGGER_EARLY)
        )?;

    let tokens =
        remaining_tokens(
            mint,
            market,
        )?;

    let native =
        market.lamports();

    let agent_balance =
        agent_token_balance(
            controller_tokens,
            mint.address(),
            controller.address(),
        )?;

    let random_buy =
        (
            (
                hash[0] ^
                entropy[0]
            ) &
            1
        ) == 0;

    let remaining_buy_cap =
        MAX_AGENT_NATIVE_IN
            .checked_sub(agent_in)
            .ok_or(
                err(ERR_TRIGGER_LIMIT)
            )?;

    let remaining_sell_cap =
        MAX_AGENT_NATIVE_OUT
            .checked_sub(agent_out)
            .ok_or(
                err(ERR_TRIGGER_LIMIT)
            )?;

    // If the random side cannot execute because the agent
    // has no tokens or that side's immutable cap is exhausted,
    // use the other available side. No caller chooses this.
    let can_buy =
        remaining_buy_cap >=
        MIN_AGENT_BUY;

    let can_sell =
        agent_balance != 0 &&
        remaining_sell_cap != 0 &&
        native != 0;

    if !can_buy && !can_sell {
        return Err(
            err(ERR_TRIGGER_LIMIT)
        );
    }

    let is_buy =
        if random_buy {
            if can_buy {
                true
            } else {
                false
            }
        } else if can_sell {
            false
        } else {
            true
        };

    let bump =
        FIXED_BUMP;

    let market_seeds = [
        Seed::from(
            MARKET_SEED
        ),
        Seed::from(
            mint.address().as_ref()
        ),
        Seed::from(
            &bump
        ),
    ];

    let market_signers = [
        Signer::from(
            &market_seeds
        )
    ];

    let mut native_in_delta =
        0u64;

    let mut native_out_delta =
        0u64;

    if is_buy {
        let mut input =
            random_buy_amount(
                &hash,
                &entropy,
            );

        if input >
           remaining_buy_cap {
            input =
                remaining_buy_cap;
        }

        if input <
           MIN_AGENT_BUY {
            return Err(
                err(ERR_TRIGGER_LIMIT)
            );
        }

        let output =
            quote_agent_buy(
                native,
                tokens,
                input,
            )?;

        // This is a REAL SOL transfer from the agent.
        SolTransfer {
            from: controller,
            to: market,
            lamports: input,
        }
        .invoke()?;

        // This is a REAL token mint from PumpLite curve inventory.
        MintTo::new(
            mint,
            controller_tokens,
            market,
            output,
        )
        .invoke_signed(
            &market_signers
        )?;

        native_in_delta =
            input;
    } else {
        let bps =
            random_sell_bps(
                &hash,
                &entropy,
            );

        let mut input =
            mul_div_ratio(
                agent_balance,
                bps,
                10_000,
            )?;

        if input == 0 {
            input = 1;
        }

        let mut gross =
            quote_agent_sell(
                native,
                tokens,
                input,
            )?;

        if gross >
           remaining_sell_cap {
            let priced =
                VIRTUAL_NATIVE
                    .checked_add(
                        native
                    )
                    .ok_or(
                        err(ERR_OVERFLOW)
                    )?;

            if remaining_sell_cap == 0 ||
               priced <=
               remaining_sell_cap {
                return Err(
                    err(ERR_TRIGGER_LIMIT)
                );
            }

            let denominator =
                priced -
                remaining_sell_cap;

            let capped_input =
                if remaining_sell_cap <
                   denominator {
                    mul_div_ratio(
                        tokens,
                        remaining_sell_cap,
                        denominator,
                    )?
                } else {
                    tokens
                        .saturating_sub(1)
                };

            if capped_input == 0 {
                return Err(
                    err(ERR_TRIGGER_LIMIT)
                );
            }

            if input >
               capped_input {
                input =
                    capped_input;
            }

            gross =
                quote_agent_sell(
                    native,
                    tokens,
                    input,
                )?;
        }

        if gross >
           remaining_sell_cap {
            return Err(
                err(ERR_TRIGGER_LIMIT)
            );
        }

        // REAL token burn from agent inventory.
        Burn::new(
            controller_tokens,
            mint,
            controller,
            input,
        )
        .invoke()?;

        // REAL SOL leaves the curve and returns to agent wallet.
        SolTransfer {
            from: market,
            to: controller,
            lamports: gross,
        }
        .invoke_signed(
            &market_signers
        )?;

        native_out_delta =
            gross;
    }

    // Only clear the request after the real trade succeeds.
    let mut current =
        state.try_borrow_mut()?;

    current[OFF_FLAGS] &=
        !FLAG_PENDING;

    put_i64(
        &mut current,
        OFF_LAST_TRADE,
        clock.unix_timestamp,
    );

    put_u64(
        &mut current,
        OFF_AGENT_IN,
        agent_in
            .checked_add(
                native_in_delta
            )
            .ok_or(
                err(ERR_OVERFLOW)
            )?,
    );

    put_u64(
        &mut current,
        OFF_AGENT_OUT,
        agent_out
            .checked_add(
                native_out_delta
            )
            .ok_or(
                err(ERR_OVERFLOW)
            )?,
    );

    put_u16(
        &mut current,
        OFF_TRADE_COUNT,
        trade_count
            .checked_add(1)
            .ok_or(
                err(ERR_OVERFLOW)
            )?,
    );

    current[
        OFF_ENTROPY..
        OFF_ENTROPY + 32
    ]
    .fill(0);

    Ok(())
}


// ------------------------------------------------------------
// Instruction router
// ------------------------------------------------------------
//
// 0 = regular user buy
// 1 = regular user sell
// 2 = initialize Trigger at creation
// 3 = creator requests one Trigger trade
// 4 = controller executes randomized real Trigger trade

fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let tag =
        *instruction_data
            .first()
            .ok_or(
                ProgramError::InvalidInstructionData
            )?;

    match tag {
        0 | 1 => {
            if instruction_data.len() != 17 {
                return Err(
                    ProgramError::InvalidInstructionData
                );
            }

            let input =
                u64_at(
                    instruction_data,
                    1,
                )?;

            let minimum_output =
                u64_at(
                    instruction_data,
                    9,
                )?;

            if input == 0 {
                return Err(
                    err(ERR_QUOTE)
                );
            }

            if minimum_output == 0 {
                return Err(
                    err(ERR_SLIPPAGE)
                );
            }

            if tag == 0 {
                buy(
                    accounts,
                    input,
                    minimum_output,
                )
            } else {
                sell(
                    accounts,
                    input,
                    minimum_output,
                )
            }
        }

        2 =>
            initialize_trigger(
                program_id,
                accounts,
                instruction_data,
            ),

        3 =>
            request_trigger(
                program_id,
                accounts,
                instruction_data,
            ),

        4 => {
            if instruction_data.len() != 1 {
                return Err(
                    ProgramError::InvalidInstructionData
                );
            }

            execute_trigger(
                program_id,
                accounts,
            )
        }

        _ =>
            Err(
                ProgramError::InvalidInstructionData
            ),
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
    fn original_25_bps_user_fee_is_unchanged() {
        for amount in [
            1u64,
            399,
            400,
            1_000,
            1_000_000,
            1_000_000_000,
            u32::MAX as u64,
        ] {
            let expected =
                (
                    (amount as u128) *
                    25u128 /
                    10_000u128
                ) as u64;

            assert_eq!(
                fee(amount),
                expected
            );
        }
    }

    #[test]
    fn compact_math_matches_reference() {
        let values = [
            1u64,
            2,
            7,
            31,
            255,
            1_000,
            1_000_000,
            30_000_000_000,
            1_000_000_000_000_000,
            u32::MAX as u64,
        ];

        for &a in &values {
            for &d0 in &values {
                let d =
                    d0.max(2);

                for &b0 in &values {
                    let b =
                        b0 % d;

                    assert_eq!(
                        mul_div_ratio(
                            a,
                            b,
                            d
                        )
                        .unwrap(),
                        reference_mul_div(
                            a,
                            b,
                            d
                        )
                    );
                }
            }
        }
    }

    #[test]
    fn trigger_buy_amount_is_always_inside_hard_caps() {
        for seed in 0..=255u8 {
            let hash =
                [seed; 32];

            let entropy =
                [255u8 - seed; 32];

            let amount =
                random_buy_amount(
                    &hash,
                    &entropy,
                );

            assert!(
                amount >=
                MIN_AGENT_BUY
            );

            assert!(
                amount <=
                MAX_AGENT_BUY
            );
        }
    }

    #[test]
    fn trigger_sell_percentage_is_always_inside_hard_caps() {
        for seed in 0..=255u8 {
            let hash =
                [seed; 32];

            let entropy =
                [seed / 2; 32];

            let bps =
                random_sell_bps(
                    &hash,
                    &entropy,
                );

            assert!(
                bps >=
                MIN_SELL_BPS
            );

            assert!(
                bps <=
                MAX_SELL_BPS
            );
        }
    }

    #[test]
    fn agent_trade_has_real_curve_effect() {
        let native =
            1_000_000_000u64;

        let tokens =
            SUPPLY;

        let buy =
            1_000_000u64;

        let output =
            quote_agent_buy(
                native,
                tokens,
                buy,
            )
            .unwrap();

        assert!(output > 0);
        assert!(output < tokens);

        let after_native =
            native + buy;

        let after_tokens =
            tokens - output;

        let sold_back =
            quote_agent_sell(
                after_native,
                after_tokens,
                output,
            )
            .unwrap();

        assert!(sold_back > 0);
        assert!(
            sold_back <=
            after_native
        );
    }

    #[test]
    fn trigger_duration_is_exactly_24_hours() {
        assert_eq!(
            TRIGGER_SECONDS,
            86_400
        );
    }
}
