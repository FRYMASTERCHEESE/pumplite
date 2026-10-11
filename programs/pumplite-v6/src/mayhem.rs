use crate::{math, LaunchError};
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub const DURATION: i64 = 86_400;
pub const MIN_INTERVAL: i64 = 300;
pub const MAX_TRADES: u16 = 48;
pub const FLOW_CAP: u64 = 100_000_000;
pub const MIN_BUY: u64 = 1_000_000;
pub const MAX_BUY: u64 = 10_000_000;
pub const PAUSE_RESERVE: u64 = 1_000_000;
pub const REVEAL_WINDOW: u64 = 512;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Default, Debug, PartialEq)]
pub struct Mayhem {
    pub mode: u8,
    pub launched_at: i64,
    pub inventory: u64,
    pub native_bank: u64,
    pub native_in: u64,
    pub native_out: u64,
    pub volume: u128,
    pub trades: u16,
    pub expired: u16,
    pub last_trade_at: i64,
    pub commitment: [u8; 32],
    pub target_slot: u64,
    pub request_nonce: u64,
    pub pending_request: bool,
    pub finalized: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn genesis_sells_are_clipped_before_real_liquidity_is_checked() {
        let native = 2 * PAUSE_RESERVE;
        assert!(math::raw_sell(native, math::SUPPLY, math::SUPPLY / 100).is_err());
        let mut sells = 0;
        for seed in 0..64u8 {
            let mut m = Mayhem::new(1, 1000).unwrap();
            m.native_bank = FLOW_CAP;
            let secret = [seed; 32];
            let market = [7; 32];
            m.commit(m.commitment_hash(&secret, &market), 1000, 10, native)
                .unwrap();
            let trade = m
                .reveal(secret, [8; 32], market, 1000, 12, native, math::SUPPLY)
                .unwrap();
            if !trade.is_buy {
                sells += 1;
                assert!(trade.native > 0 && trade.native <= native - PAUSE_RESERVE);
                assert!(trade.native_reserve >= PAUSE_RESERVE);
                assert_eq!(m.native_bank, FLOW_CAP + trade.native);
            }
            assert_eq!(trade.native_reserve + m.native_bank, native + FLOW_CAP);
            assert_eq!(trade.token_reserve + m.inventory, 2 * math::SUPPLY);
        }
        assert!(
            sells > 0,
            "Known deterministic fixture must cover the sell branch"
        );
    }
    #[test]
    fn immutable_modes_inventory_and_manual_request_gate() {
        assert!(Mayhem::new(3, 1000).is_err());
        assert_eq!(Mayhem::new(0, 1000).unwrap().inventory, 0);
        let mut auto = Mayhem::new(1, 1000).unwrap();
        assert_eq!(auto.inventory, math::SUPPLY);
        assert!(auto.request(1000).is_err());
        assert!(auto.commit([1; 32], 1000, 10, 0).is_err());
        let mut manual = Mayhem::new(2, 1000).unwrap();
        assert!(manual.commit([1; 32], 1000, 10, PAUSE_RESERVE).is_err());
        manual.request(1000).unwrap();
        assert!(manual.request(1000).is_err());
        manual.commit([1; 32], 1000, 10, PAUSE_RESERVE).unwrap();
    }
    #[test]
    fn future_slot_secret_interval_and_expiry_fail_closed() {
        let mut m = Mayhem::new(1, 1000).unwrap();
        m.native_bank = FLOW_CAP;
        let secret = [2; 32];
        let address = [3; 32];
        let commitment = m.commitment_hash(&secret, &address);
        m.commit(commitment, 1000, 10, FLOW_CAP).unwrap();
        assert_eq!(m.target_slot, 11);
        for (s, hash, slot) in [
            (secret, [4; 32], 11),
            ([5; 32], [4; 32], 12),
            (secret, [0; 32], 12),
            (secret, [4; 32], 524),
        ] {
            let before = m.clone();
            assert!(m
                .reveal(s, hash, address, 1000, slot, FLOW_CAP, math::SUPPLY)
                .is_err());
            assert_eq!(m.clone(), before);
        }
        assert!(m.expire(1000, 523).is_err());
        m.expire(1000, 524).unwrap();
        assert_eq!(m.expired, 1);
        assert!(m.commit(commitment, 1299, 525, FLOW_CAP).is_err());
        m.commit(commitment, 1300, 525, FLOW_CAP).unwrap();
    }
    #[test]
    fn agent_trades_conserve_actual_backing_and_enforce_flow_caps() {
        for seed in 0..64u8 {
            let mut m = Mayhem::new(1, 1000).unwrap();
            m.native_bank = FLOW_CAP;
            let mut native = 1_000_000_000;
            let mut tokens = math::SUPPLY;
            let total_native = native + m.native_bank;
            let total_tokens = tokens + m.inventory;
            let address = [7; 32];
            for n in 0..MAX_TRADES {
                let now = 1000 + i64::from(n) * MIN_INTERVAL;
                let slot = 10 + u64::from(n) * 1000;
                let secret = [seed.wrapping_add(n as u8); 32];
                let c = m.commitment_hash(&secret, &address);
                if m.ended(now) {
                    break;
                }
                m.commit(c, now, slot, native).unwrap();
                let before = m.clone();
                match m.reveal(
                    secret,
                    [seed.wrapping_add(1); 32],
                    address,
                    now,
                    slot + 2,
                    native,
                    tokens,
                ) {
                    Ok(result) => {
                        native = result.native_reserve;
                        tokens = result.token_reserve;
                    }
                    Err(_) => {
                        assert_eq!(m.clone(), before);
                        m.expire(now, slot + REVEAL_WINDOW + 2).unwrap();
                    }
                }
                assert_eq!(native + m.native_bank, total_native);
                assert_eq!(tokens + m.inventory, total_tokens);
                assert!(m.native_in <= FLOW_CAP && m.native_out <= FLOW_CAP);
                assert!(m.trades + m.expired <= MAX_TRADES);
            }
            assert!(m.ended(1000 + i64::from(MAX_TRADES) * MIN_INTERVAL));
        }
    }
    #[test]
    fn abandoning_every_commitment_consumes_the_attempt_budget() {
        let mut m = Mayhem::new(1, 1000).unwrap();
        for n in 0..MAX_TRADES {
            let now = 1000 + i64::from(n) * MIN_INTERVAL;
            let slot = u64::from(n) * 1000;
            m.commit([1; 32], now, slot, PAUSE_RESERVE).unwrap();
            m.expire(now, slot + REVEAL_WINDOW + 2).unwrap();
        }
        assert!(m.ended(2000));
        assert!(m.commit([1; 32], 20_000, 100_000, PAUSE_RESERVE).is_err());
    }
}
#[derive(Debug)]
pub struct AgentTrade {
    pub is_buy: bool,
    pub native: u64,
    pub tokens: u64,
    pub native_reserve: u64,
    pub token_reserve: u64,
    pub randomness: [u8; 32],
}
impl Mayhem {
    pub fn new(mode: u8, now: i64) -> Result<Self> {
        require!(mode <= 2, LaunchError::Mode);
        Ok(Self {
            mode,
            launched_at: now,
            inventory: if mode == 0 { 0 } else { math::SUPPLY },
            ..Self::default()
        })
    }
    pub fn ended(&self, now: i64) -> bool {
        self.finalized
            || now >= self.launched_at.saturating_add(DURATION)
            || u32::from(self.trades) + u32::from(self.expired) >= u32::from(MAX_TRADES)
            || (self.native_in >= FLOW_CAP && self.native_out >= FLOW_CAP)
    }
    pub fn active(&self, now: i64, native: u64) -> bool {
        self.mode != 0 && !self.ended(now) && native >= PAUSE_RESERVE
    }
    pub fn request(&mut self, now: i64) -> Result<()> {
        require!(self.mode == 2, LaunchError::Mode);
        require!(
            !self.ended(now) && !self.pending_request,
            LaunchError::MayhemState
        );
        self.request_nonce = self
            .request_nonce
            .checked_add(1)
            .ok_or(LaunchError::Overflow)?;
        self.pending_request = true;
        Ok(())
    }
    pub fn commitment_hash(&self, secret: &[u8; 32], market: &[u8; 32]) -> [u8; 32] {
        hashv(&[
            b"PumpLite-V6-commit",
            secret,
            market,
            &self.request_nonce.to_le_bytes(),
            &self.trades.to_le_bytes(),
        ])
        .to_bytes()
    }
    pub fn commit(&mut self, commitment: [u8; 32], now: i64, slot: u64, native: u64) -> Result<()> {
        require!(self.active(now, native), LaunchError::MayhemState);
        require!(
            commitment != [0; 32] && self.commitment == [0; 32],
            LaunchError::Commitment
        );
        require!(
            self.mode != 2 || self.pending_request,
            LaunchError::MayhemRequest
        );
        require!(
            self.last_trade_at == 0 || now >= self.last_trade_at.saturating_add(MIN_INTERVAL),
            LaunchError::MayhemState
        );
        self.target_slot = slot.checked_add(1).ok_or(LaunchError::Overflow)?;
        self.commitment = commitment;
        Ok(())
    }
    pub fn expire(&mut self, now: i64, slot: u64) -> Result<()> {
        require!(self.commitment != [0; 32], LaunchError::Commitment);
        require!(
            slot > self.target_slot.saturating_add(REVEAL_WINDOW),
            LaunchError::Reveal
        );
        self.expired = self.expired.checked_add(1).ok_or(LaunchError::Overflow)?;
        self.commitment = [0; 32];
        self.target_slot = 0;
        self.pending_request = false;
        self.last_trade_at = now;
        Ok(())
    }
    pub fn reveal(
        &mut self,
        secret: [u8; 32],
        future_hash: [u8; 32],
        market: [u8; 32],
        now: i64,
        slot: u64,
        native: u64,
        tokens: u64,
    ) -> Result<AgentTrade> {
        require!(self.active(now, native), LaunchError::MayhemState);
        require!(
            self.commitment != [0; 32] && self.commitment_hash(&secret, &market) == self.commitment,
            LaunchError::Commitment
        );
        require!(
            slot > self.target_slot
                && slot <= self.target_slot.saturating_add(REVEAL_WINDOW)
                && future_hash != [0; 32],
            LaunchError::Reveal
        );
        let random = hashv(&[
            b"PumpLite-V6-reveal",
            &secret,
            &future_hash,
            &market,
            &self.request_nonce.to_le_bytes(),
            &self.trades.to_le_bytes(),
        ])
        .to_bytes();
        let is_buy = random[0] & 1 == 0;
        let size = u64::from_le_bytes(
            random[8..16]
                .try_into()
                .map_err(|_| error!(LaunchError::Reveal))?,
        );
        let (amount, token_amount, new_native, new_tokens, bank, inventory) = if is_buy {
            let high = MAX_BUY
                .min(
                    FLOW_CAP
                        .checked_sub(self.native_in)
                        .ok_or(LaunchError::MayhemState)?,
                )
                .min(self.native_bank);
            require!(high >= MIN_BUY, LaunchError::MayhemFunding);
            let amount = MIN_BUY + size % (high - MIN_BUY + 1);
            let out =
                math::raw_buy(native, tokens, amount).map_err(|_| error!(LaunchError::Quote))?;
            (
                amount,
                out,
                native.checked_add(amount),
                tokens.checked_sub(out),
                self.native_bank.checked_sub(amount),
                self.inventory.checked_add(out),
            )
        } else {
            let remaining = FLOW_CAP
                .checked_sub(self.native_out)
                .ok_or(LaunchError::MayhemState)?
                .min(
                    native
                        .checked_sub(PAUSE_RESERVE)
                        .ok_or(LaunchError::MayhemState)?,
                );
            require!(
                remaining > 0 && self.inventory > 0,
                LaunchError::MayhemFunding
            );
            let bps = 100 + size % 401;
            let mut sold = u64::try_from((self.inventory as u128) * (bps as u128) / 10_000)
                .map_err(|_| error!(LaunchError::Overflow))?
                .max(1);
            let pricing = math::VIRTUAL_NATIVE
                .checked_add(native)
                .ok_or(LaunchError::Overflow)?;
            let mut out =
                u64::try_from((pricing as u128) * (sold as u128) / (tokens as u128 + sold as u128))
                    .map_err(|_| error!(LaunchError::Overflow))?;
            if out > remaining {
                require!(remaining < pricing, LaunchError::MayhemState);
                sold = u64::try_from(
                    (remaining as u128) * (tokens as u128) / (pricing - remaining) as u128,
                )
                .map_err(|_| error!(LaunchError::Overflow))?;
                require!(
                    sold > 0 && sold <= self.inventory,
                    LaunchError::MayhemFunding
                );
                out =
                    math::raw_sell(native, tokens, sold).map_err(|_| error!(LaunchError::Quote))?;
                require!(out <= remaining, LaunchError::MayhemState);
            }
            require!(out > 0 && out <= native, LaunchError::Quote);
            (
                out,
                sold,
                native.checked_sub(out),
                tokens.checked_add(sold),
                self.native_bank.checked_add(out),
                self.inventory.checked_sub(sold),
            )
        };
        // Compute all fallible effects before committing state; runtime failures also roll back atomically.
        let result = AgentTrade {
            is_buy,
            native: amount,
            tokens: token_amount,
            native_reserve: new_native.ok_or(LaunchError::Overflow)?,
            token_reserve: new_tokens.ok_or(LaunchError::Overflow)?,
            randomness: random,
        };
        let next_bank = bank.ok_or(LaunchError::Overflow)?;
        let next_inventory = inventory.ok_or(LaunchError::Overflow)?;
        let next_in = self
            .native_in
            .checked_add(if is_buy { amount } else { 0 })
            .ok_or(LaunchError::Overflow)?;
        let next_out = self
            .native_out
            .checked_add(if is_buy { 0 } else { amount })
            .ok_or(LaunchError::Overflow)?;
        let next_volume = self
            .volume
            .checked_add(amount as u128)
            .ok_or(LaunchError::Overflow)?;
        let next_trades = self.trades.checked_add(1).ok_or(LaunchError::Overflow)?;
        self.native_bank = next_bank;
        self.inventory = next_inventory;
        self.native_in = next_in;
        self.native_out = next_out;
        self.volume = next_volume;
        self.trades = next_trades;
        self.last_trade_at = now;
        self.commitment = [0; 32];
        self.target_slot = 0;
        self.pending_request = false;
        Ok(result)
    }
}
