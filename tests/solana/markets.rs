//! Executes the compiled SBF artifact in a process-local VM. No RPC or persisted signers.
use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token::{
    self,
    state::{Account as TokenState, Mint as MintState},
};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionResult},
    LiteSVM,
};
use pumplite::{math, Market, DECIMALS, ID, TREASURY};
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const SOL: u64 = 1_000_000_000;
fn vm(k: Pubkey) -> Address {
    Address::new_from_array(k.to_bytes())
}
fn pk(k: Address) -> Pubkey {
    Pubkey::new_from_array(k.to_bytes())
}
fn token_id() -> Address {
    vm(spl_token::ID)
}
fn ata(mint: Address, owner: Address) -> Address {
    vm(Pubkey::find_program_address(
        &[owner.as_ref(), token_id().as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    )
    .0)
}
fn anchor_ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: vm(ID),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|a| AccountMeta {
                pubkey: Address::new_from_array(a.pubkey.to_bytes()),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
        data: data.data(),
    }
}
fn spl_ix(ix: anchor_lang::solana_program::instruction::Instruction) -> Instruction {
    Instruction {
        program_id: Address::new_from_array(ix.program_id.to_bytes()),
        accounts: ix
            .accounts
            .into_iter()
            .map(|a| AccountMeta {
                pubkey: Address::new_from_array(a.pubkey.to_bytes()),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Snapshot {
    state: Vec<u8>,
    mint: Vec<u8>,
    vault: Vec<u8>,
    trader_tokens: Vec<u8>,
    native: u64,
    trader_native: u64,
    treasury_native: u64,
}
struct TestMarket {
    svm: LiteSVM,
    payer: Keypair,
    creator: Keypair,
    trader: Keypair,
    mint: Address,
    market: Address,
    vault: Address,
    trader_tokens: Address,
    nonce: u64,
}
impl TestMarket {
    fn uncreated() -> Self {
        let path = std::env::var("PUMPLITE_SBF")
            .expect("PUMPLITE_SBF must point to the compiled program; SBF tests never skip");
        let bytes = std::fs::read(path).expect("Missing SBF artifact");
        assert!(
            bytes.starts_with(b"\x7fELF"),
            "Expected compiled ELF, not a native mock"
        );
        let mut svm = LiteSVM::new();
        svm.add_program(vm(ID), &bytes)
            .expect("SBF program must load");
        let payer = Keypair::new();
        let creator = Keypair::new();
        let trader = Keypair::new();
        for address in [
            payer.pubkey(),
            creator.pubkey(),
            trader.pubkey(),
            vm(TREASURY),
        ] {
            svm.airdrop(&address, 100 * SOL).unwrap();
        }
        let mut clock: Clock = svm.get_sysvar();
        clock.unix_timestamp = 1_000_000;
        svm.set_sysvar(&clock);
        let nonce = 42u64;
        let mint = vm(Pubkey::find_program_address(
            &[b"mint", creator.pubkey().as_ref(), &nonce.to_le_bytes()],
            &ID,
        )
        .0);
        let market = vm(Pubkey::find_program_address(&[b"market", mint.as_ref()], &ID).0);
        let trader_tokens = ata(mint, trader.pubkey());
        Self {
            svm,
            payer,
            creator,
            trader,
            mint,
            market,
            vault: ata(mint, market),
            trader_tokens,
            nonce,
        }
    }
    fn create_ix(&self, name: &str) -> Instruction {
        anchor_ix(
            pumplite::accounts::CreateMarket {
                creator: pk(self.creator.pubkey()),
                mint: pk(self.mint),
                market: pk(self.market),
                vault: pk(self.vault),
                token_program: spl_token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                system_program: anchor_lang::system_program::ID,
            },
            pumplite::instruction::CreateMarket {
                nonce: self.nonce,
                name: name.into(),
                symbol: "TEST".into(),
                uri: "ipfs://test".into(),
            },
        )
    }
    fn new() -> Self {
        let mut f = Self::uncreated();
        let ix = f.create_ix("Test token");
        f.send(vec![ix], true).unwrap();
        let ix = Instruction {
            program_id: vm(anchor_spl::associated_token::ID),
            data: vec![1],
            accounts: vec![
                AccountMeta::new(f.payer.pubkey(), true),
                AccountMeta::new(f.trader_tokens, false),
                AccountMeta::new_readonly(f.trader.pubkey(), false),
                AccountMeta::new_readonly(f.mint, false),
                AccountMeta::new_readonly(vm(anchor_lang::system_program::ID), false),
                AccountMeta::new_readonly(token_id(), false),
            ],
        };
        f.send(vec![ix], false).unwrap();
        f
    }
    fn send(&mut self, instructions: Vec<Instruction>, creator: bool) -> TransactionResult {
        self.svm.expire_blockhash();
        let hash = self.svm.latest_blockhash();
        let signer = if creator { &self.creator } else { &self.trader };
        let msg = Message::new_with_blockhash(&instructions, Some(&self.payer.pubkey()), &hash);
        let mut signers = vec![&self.payer];
        if msg
            .account_keys
            .iter()
            .take(msg.header.num_required_signatures as usize)
            .any(|k| k == &signer.pubkey())
        {
            signers.push(signer);
        }
        self.svm
            .send_transaction(Transaction::new(&signers, msg, hash))
    }
    fn accounts(&self) -> pumplite::accounts::Trade {
        pumplite::accounts::Trade {
            trader: pk(self.trader.pubkey()),
            market: pk(self.market),
            mint: pk(self.mint),
            vault: pk(self.vault),
            trader_tokens: pk(self.trader_tokens),
            treasury: TREASURY,
            token_program: spl_token::ID,
            system_program: anchor_lang::system_program::ID,
        }
    }
    fn buy_ix(&self, input: u64, min: u64) -> Instruction {
        anchor_ix(
            self.accounts(),
            pumplite::instruction::Buy {
                input,
                minimum_output: min,
                deadline: 1_000_180,
            },
        )
    }
    fn sell_ix(&self, input: u64, min: u64) -> Instruction {
        anchor_ix(
            self.accounts(),
            pumplite::instruction::Sell {
                input,
                minimum_output: min,
                deadline: 1_000_180,
            },
        )
    }
    fn state(&self) -> Market {
        Market::try_deserialize(&mut self.svm.get_account(&self.market).unwrap().data.as_slice())
            .unwrap()
    }
    fn native(&self, key: Address) -> u64 {
        self.svm.get_account(&key).map_or(0, |a| a.lamports)
    }
    fn tokens(&self, key: Address) -> u64 {
        TokenState::unpack(&self.svm.get_account(&key).unwrap().data)
            .unwrap()
            .amount
    }
    fn supply(&self) -> MintState {
        MintState::unpack(&self.svm.get_account(&self.mint).unwrap().data).unwrap()
    }
    fn backing(&self) {
        let state = self.state();
        let rent = self.svm.minimum_balance_for_rent_exemption(
            self.svm.get_account(&self.market).unwrap().data.len(),
        );
        assert_eq!(self.native(self.market), rent + state.native_reserve);
        assert_eq!(self.tokens(self.vault), state.token_reserve);
        assert_eq!(self.supply().supply, math::SUPPLY);
        assert_eq!(
            self.tokens(self.vault) + self.tokens(self.trader_tokens),
            math::SUPPLY
        );
    }
    fn snapshot(&self) -> Snapshot {
        let data = |key| self.svm.get_account(&key).unwrap().data;
        Snapshot {
            state: data(self.market),
            mint: data(self.mint),
            vault: data(self.vault),
            trader_tokens: data(self.trader_tokens),
            native: self.native(self.market),
            trader_native: self.native(self.trader.pubkey()),
            treasury_native: self.native(vm(TREASURY)),
        }
    }
    fn reject(&mut self, ix: Instruction, expected_code: u32) {
        let before = self.snapshot();
        let failed = self.send(vec![ix], false).unwrap_err();
        custom_error(&failed, expected_code);
        assert_eq!(
            self.snapshot(),
            before,
            "Failed instruction must roll back funds, tokens, fees and state"
        );
    }
}
fn custom_error(failed: &FailedTransactionMetadata, code: u32) {
    assert_eq!(
        format!("{:?}", failed.err),
        format!("InstructionError(0, Custom({code}))"),
        "logs: {:?}",
        failed.meta.logs
    );
}
fn error(code: pumplite::LaunchError) -> u32 {
    code as u32 + 6000
}

#[test]
fn create_market_initializes_inventory_and_revokes_authorities() {
    let f = TestMarket::new();
    let state = f.state();
    let mint = f.supply();
    assert_eq!(state.creator.to_bytes(), f.creator.pubkey().to_bytes());
    assert_eq!(state.mint.to_bytes(), f.mint.to_bytes());
    assert_eq!(state.native_reserve, 0);
    assert_eq!(state.token_reserve, math::SUPPLY);
    assert_eq!(state.volume, 0);
    assert_eq!(state.name, "Test token");
    assert_eq!(mint.decimals, DECIMALS);
    assert!(mint.mint_authority.is_none());
    assert!(mint.freeze_authority.is_none());
    assert_eq!(f.svm.get_account(&f.market).unwrap().data.len(), 368);
    f.backing();
}
#[test]
fn create_invalid_metadata_and_duplicate_market_are_rejected() {
    let mut f = TestMarket::uncreated();
    let ix = f.create_ix("");
    let failed = f.send(vec![ix], true).unwrap_err();
    custom_error(&failed, error(pumplite::LaunchError::Metadata));
    for key in [f.market, f.mint, f.vault] {
        assert!(f.svm.get_account(&key).is_none());
    }
    let ix = f.create_ix("Valid");
    f.send(vec![ix], true).unwrap();
    let before = f.svm.get_account(&f.market).unwrap().data;
    let ix = f.create_ix("Duplicate");
    assert!(f.send(vec![ix], true).is_err());
    assert_eq!(f.svm.get_account(&f.market).unwrap().data, before);
}
#[test]
fn buy_routes_exact_fee_and_backs_reserves() {
    let mut f = TestMarket::new();
    let input = SOL;
    let treasury = f.native(vm(TREASURY));
    let trader = f.native(f.trader.pubkey());
    let (out, fee) = math::buy(0, math::SUPPLY, input).unwrap();
    assert_eq!(out, 32_180_014_517_299);
    assert_eq!(fee, 2_500_000);
    let ix = f.buy_ix(input, out);
    let metadata = f.send(vec![ix], false).unwrap();
    assert!(metadata.compute_units_consumed > 0);
    assert_eq!(f.tokens(f.trader_tokens), out);
    assert_eq!(f.native(f.trader.pubkey()), trader - input);
    assert_eq!(f.native(vm(TREASURY)), treasury + fee);
    assert_eq!(f.state().native_reserve, input - fee);
    assert_eq!(f.state().volume, input as u128);
    f.backing();
}
#[test]
fn sell_returns_tokens_and_routes_fee_without_burning() {
    let mut f = TestMarket::new();
    let ix = f.buy_ix(SOL, 1);
    f.send(vec![ix], false).unwrap();
    let sold = f.tokens(f.trader_tokens);
    let s = f.state();
    let (gross, fee) = math::sell(s.native_reserve, s.token_reserve, sold).unwrap();
    let trader = f.native(f.trader.pubkey());
    let treasury = f.native(vm(TREASURY));
    let ix = f.sell_ix(sold, gross - fee);
    f.send(vec![ix], false).unwrap();
    assert_eq!(f.native(f.trader.pubkey()), trader + gross - fee);
    assert_eq!(f.native(vm(TREASURY)), treasury + fee);
    assert_eq!(f.tokens(f.trader_tokens), 0);
    assert_eq!(f.state().token_reserve, math::SUPPLY);
    assert_eq!(f.state().native_reserve, s.native_reserve - gross);
    assert_eq!(f.state().volume, SOL as u128 + gross as u128);
    f.backing();
}
#[test]
fn repeated_trades_conserve_inventory_native_backing_and_invariant() {
    let mut f = TestMarket::new();
    for n in 1..=20u64 {
        let before = f.state();
        let k = (math::VIRTUAL_NATIVE as u128 + before.native_reserve as u128)
            * before.token_reserve as u128;
        let ix = f.buy_ix(n * 1_000_000, 1);
        f.send(vec![ix], false).unwrap();
        f.backing();
        let s = f.state();
        assert!(
            (math::VIRTUAL_NATIVE as u128 + s.native_reserve as u128) * s.token_reserve as u128
                >= k
        );
        let k = (math::VIRTUAL_NATIVE as u128 + s.native_reserve as u128) * s.token_reserve as u128;
        let ix = f.sell_ix(f.tokens(f.trader_tokens) / 2, 1);
        f.send(vec![ix], false).unwrap();
        f.backing();
        let s = f.state();
        assert!(
            (math::VIRTUAL_NATIVE as u128 + s.native_reserve as u128) * s.token_reserve as u128
                >= k
        );
    }
}
#[test]
fn buy_and_sell_slippage_fail_atomically() {
    let mut f = TestMarket::new();
    let (out, _) = math::buy(0, math::SUPPLY, SOL).unwrap();
    f.reject(
        f.buy_ix(SOL, out + 1),
        error(pumplite::LaunchError::Slippage),
    );
    f.reject(f.buy_ix(SOL, 0), error(pumplite::LaunchError::Slippage));
    let ix = f.buy_ix(SOL, out);
    f.send(vec![ix], false).unwrap();
    let s = f.state();
    let held = f.tokens(f.trader_tokens);
    let (gross, fee) = math::sell(s.native_reserve, s.token_reserve, held).unwrap();
    f.reject(
        f.sell_ix(held, gross - fee + 1),
        error(pumplite::LaunchError::Slippage),
    );
}
#[test]
fn expired_and_excessive_deadlines_are_rejected() {
    let mut f = TestMarket::new();
    for deadline in [999_999, 1_000_301] {
        let ix = anchor_ix(
            f.accounts(),
            pumplite::instruction::Buy {
                input: SOL,
                minimum_output: 1,
                deadline,
            },
        );
        f.reject(ix, error(pumplite::LaunchError::Expired));
    }
}
#[test]
fn no_real_liquidity_zero_amount_and_impossible_inventory_are_rejected() {
    let mut f = TestMarket::new();
    f.reject(f.sell_ix(1, 1), error(pumplite::LaunchError::Quote));
    f.reject(f.buy_ix(0, 1), error(pumplite::LaunchError::Quote));
    f.reject(
        f.sell_ix(math::SUPPLY, 1),
        error(pumplite::LaunchError::Quote),
    );
}
#[test]
fn insufficient_seller_tokens_roll_back_everything() {
    let mut f = TestMarket::new();
    let ix = f.buy_ix(SOL, 1);
    f.send(vec![ix], false).unwrap();
    // Move legitimately purchased inventory away, leaving a backed quote but no seller balance.
    let amount = f.tokens(f.trader_tokens);
    let ix = spl_ix(
        spl_token::instruction::transfer_checked(
            &spl_token::ID,
            &pk(f.trader_tokens),
            &pk(f.mint),
            &pk(f.vault),
            &pk(f.trader.pubkey()),
            &[],
            amount,
            DECIMALS,
        )
        .unwrap(),
    );
    f.send(vec![ix], false).unwrap();
    f.reject(
        f.sell_ix(amount, 1),
        spl_token::error::TokenError::InsufficientFunds as u32,
    );
}
#[test]
fn arbitrary_treasury_is_rejected_before_funds_move() {
    let mut f = TestMarket::new();
    let mut ix = f.buy_ix(SOL, 1);
    ix.accounts[5].pubkey = f.creator.pubkey();
    f.reject(ix, anchor_lang::error::ErrorCode::ConstraintAddress as u32);
}
#[test]
fn wrong_vault_and_other_owners_token_account_are_rejected() {
    let mut f = TestMarket::new();
    let mut ix = f.buy_ix(SOL, 1);
    ix.accounts[3].pubkey = f.trader_tokens;
    let before = f.snapshot();
    let failed = f.send(vec![ix], false).unwrap_err();
    assert!(
        failed
            .meta
            .logs
            .iter()
            .any(|s| s.contains("ConstraintDuplicateMutableAccount")),
        "{:?}",
        failed.meta.logs
    );
    assert_eq!(f.snapshot(), before);
    let mut ix = f.buy_ix(SOL, 1);
    ix.accounts[4].pubkey = f.vault;
    let failed = f.send(vec![ix], false).unwrap_err();
    assert!(
        failed
            .meta
            .logs
            .iter()
            .any(|s| s.contains("trader_tokens") && s.contains("AnchorError")),
        "{:?}",
        failed.meta.logs
    );
    assert_eq!(f.snapshot(), before);
}
#[test]
fn missing_trader_signature_is_rejected() {
    let mut f = TestMarket::new();
    let mut ix = f.buy_ix(SOL, 1);
    ix.accounts[0].is_signer = false;
    f.reject(ix, anchor_lang::error::ErrorCode::AccountNotSigner as u32);
}
#[test]
fn creator_cannot_mint_more_or_freeze_inventory() {
    let mut f = TestMarket::new();
    let before = f.snapshot();
    let mint = spl_ix(
        spl_token::instruction::mint_to(
            &spl_token::ID,
            &pk(f.mint),
            &pk(f.vault),
            &pk(f.creator.pubkey()),
            &[],
            1,
        )
        .unwrap(),
    );
    let failed = f.send(vec![mint], true).unwrap_err();
    custom_error(&failed, spl_token::error::TokenError::FixedSupply as u32);
    let freeze = spl_ix(
        spl_token::instruction::freeze_account(
            &spl_token::ID,
            &pk(f.vault),
            &pk(f.mint),
            &pk(f.creator.pubkey()),
            &[],
        )
        .unwrap(),
    );
    assert!(f.send(vec![freeze], true).is_err());
    assert_eq!(f.snapshot(), before);
}
#[test]
fn wrong_token_program_and_unknown_privileged_instruction_are_rejected() {
    let mut f = TestMarket::new();
    let mut ix = f.buy_ix(SOL, 1);
    ix.accounts[6].pubkey = vm(anchor_lang::system_program::ID);
    f.reject(ix, anchor_lang::error::ErrorCode::InvalidProgramId as u32);
    let mut ix = f.buy_ix(SOL, 1);
    ix.data = vec![255; 8];
    f.reject(
        ix,
        anchor_lang::error::ErrorCode::InstructionFallbackNotFound as u32,
    );
}

#[test]
fn insufficient_buyer_sol_rolls_back_fee_and_inventory() {
    let mut f = TestMarket::new();
    let ix = f.buy_ix(101 * SOL, 1);
    f.reject(ix, 1); // SystemError::ResultWithNegativeLamports
}

#[test]
fn missing_native_or_token_backing_is_rejected() {
    for native in [true, false] {
        let mut f = TestMarket::new();
        let ix = f.buy_ix(SOL, 1);
        f.send(vec![ix], false).unwrap();
        // Fault injection inside the VM only; no instruction permits this mutation.
        let address = if native { f.market } else { f.vault };
        let mut account = f.svm.get_account(&address).unwrap();
        if native {
            account.lamports -= 1;
        } else {
            let mut tokens = TokenState::unpack(&account.data).unwrap();
            tokens.amount -= 1;
            TokenState::pack(tokens, &mut account.data).unwrap();
        }
        f.svm.set_account(address, account).unwrap();
        f.reject(f.buy_ix(SOL, 1), error(pumplite::LaunchError::Backing));
        f.reject(
            f.sell_ix(1_000_000, 1),
            error(pumplite::LaunchError::Backing),
        );
    }
}

#[test]
fn direct_donations_do_not_change_quotes_or_become_claimable_reserves() {
    let mut f = TestMarket::new();
    let ix = f.buy_ix(SOL, 1);
    f.send(vec![ix], false).unwrap();
    let state_before = f.svm.get_account(&f.market).unwrap().data;
    let held = f.tokens(f.trader_tokens);
    let donated_tokens = held / 2;
    let ix = spl_ix(
        spl_token::instruction::transfer_checked(
            &spl_token::ID,
            &pk(f.trader_tokens),
            &pk(f.mint),
            &pk(f.vault),
            &pk(f.trader.pubkey()),
            &[],
            donated_tokens,
            DECIMALS,
        )
        .unwrap(),
    );
    f.send(vec![ix], false).unwrap();
    // Fixture account credit models unsolicited native funds independently of pricing.
    let mut account = f.svm.get_account(&f.market).unwrap();
    account.lamports += SOL;
    f.svm.set_account(f.market, account).unwrap();
    assert_eq!(f.svm.get_account(&f.market).unwrap().data, state_before);
    let ix = f.sell_ix(held - donated_tokens, 1);
    f.send(vec![ix], false).unwrap();
    let s = f.state();
    let rent = f
        .svm
        .minimum_balance_for_rent_exemption(f.svm.get_account(&f.market).unwrap().data.len());
    assert_eq!(f.native(f.market), rent + s.native_reserve + SOL);
    assert_eq!(f.tokens(f.vault), s.token_reserve + donated_tokens);
    assert_eq!(f.supply().supply, math::SUPPLY);
}

#[test]
fn missing_creator_signature_is_rejected_before_initialization() {
    let mut f = TestMarket::uncreated();
    let mut ix = f.create_ix("No signer");
    ix.accounts[0].is_signer = false;
    let failed = f.send(vec![ix], true).unwrap_err();
    custom_error(
        &failed,
        anchor_lang::error::ErrorCode::AccountNotSigner as u32,
    );
    for key in [f.market, f.mint, f.vault] {
        assert!(f.svm.get_account(&key).is_none());
    }
}

#[test]
fn nonaliased_wrong_token_accounts_and_foreign_market_mint_are_rejected() {
    let mut f = TestMarket::new();
    let other_tokens = ata(f.mint, f.creator.pubkey());
    let ix = Instruction {
        program_id: vm(anchor_spl::associated_token::ID),
        data: vec![1],
        accounts: vec![
            AccountMeta::new(f.payer.pubkey(), true),
            AccountMeta::new(other_tokens, false),
            AccountMeta::new_readonly(f.creator.pubkey(), false),
            AccountMeta::new_readonly(f.mint, false),
            AccountMeta::new_readonly(vm(anchor_lang::system_program::ID), false),
            AccountMeta::new_readonly(token_id(), false),
        ],
    };
    f.send(vec![ix], false).unwrap();
    for (index, field) in [(3, "vault"), (4, "trader_tokens")] {
        let before = f.snapshot();
        let mut ix = f.buy_ix(SOL, 1);
        ix.accounts[index].pubkey = other_tokens;
        let failed = f.send(vec![ix], false).unwrap_err();
        assert!(
            failed
                .meta
                .logs
                .iter()
                .any(|s| s.contains("AnchorError") && s.contains(field)),
            "{:?}",
            failed.meta.logs
        );
        assert_eq!(f.snapshot(), before);
        assert_eq!(f.tokens(other_tokens), 0);
    }
    let other = TestMarket::new();
    f.svm
        .set_account(other.mint, other.svm.get_account(&other.mint).unwrap())
        .unwrap();
    let mut ix = f.buy_ix(SOL, 1);
    ix.accounts[2].pubkey = other.mint;
    f.reject(ix, anchor_lang::error::ErrorCode::ConstraintSeeds as u32);
}

#[test]
fn incorrect_creation_nonce_cannot_substitute_mint_pda() {
    let mut f = TestMarket::uncreated();
    let creator_lamports = f.native(f.creator.pubkey());
    let mut ix = f.create_ix("Wrong PDA");
    ix.data = pumplite::instruction::CreateMarket {
        nonce: f.nonce + 1,
        name: "Wrong PDA".into(),
        symbol: "TEST".into(),
        uri: String::new(),
    }
    .data();
    let failed = f.send(vec![ix], true).unwrap_err();
    custom_error(
        &failed,
        anchor_lang::error::ErrorCode::ConstraintSeeds as u32,
    );
    assert_eq!(f.native(f.creator.pubkey()), creator_lamports);
    for key in [f.market, f.mint, f.vault] {
        assert!(f.svm.get_account(&key).is_none());
    }
}

#[test]
fn only_program_pda_can_authorize_vault_token_transfers() {
    let mut f = TestMarket::new();
    let vault = TokenState::unpack(&f.svm.get_account(&f.vault).unwrap().data).unwrap();
    assert_eq!(vault.owner, pk(f.market));
    assert!(vault.delegate.is_none());
    assert!(vault.close_authority.is_none());
    let before = f.snapshot();
    let ix = spl_ix(
        spl_token::instruction::transfer_checked(
            &spl_token::ID,
            &pk(f.vault),
            &pk(f.mint),
            &pk(f.trader_tokens),
            &pk(f.creator.pubkey()),
            &[],
            1,
            DECIMALS,
        )
        .unwrap(),
    );
    let failed = f.send(vec![ix], true).unwrap_err();
    custom_error(&failed, spl_token::error::TokenError::OwnerMismatch as u32);
    assert_eq!(f.snapshot(), before);

    let mut ix = spl_ix(
        spl_token::instruction::transfer_checked(
            &spl_token::ID,
            &pk(f.vault),
            &pk(f.mint),
            &pk(f.trader_tokens),
            &pk(f.market),
            &[],
            1,
            DECIMALS,
        )
        .unwrap(),
    );
    // A caller cannot mark a PDA signed by simply supplying its public address.
    ix.accounts[3].is_signer = false;
    let failed = f.send(vec![ix], false).unwrap_err();
    assert_eq!(
        format!("{:?}", failed.err),
        "InstructionError(0, MissingRequiredSignature)"
    );
    assert_eq!(f.snapshot(), before);
}
