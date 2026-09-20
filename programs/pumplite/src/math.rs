// Pure integer arithmetic, independent of the runtime. All amounts are raw units.
pub const FEE_BPS: u64 = 25;
pub const BPS: u64 = 10_000;
pub const SUPPLY: u64 = 1_000_000_000_000_000; // 1 billion, 6 decimals
pub const VIRTUAL_NATIVE: u64 = 30_000_000_000; // pricing offset, NOT spendable SOL

#[derive(Debug, PartialEq)]
pub enum MathError { Overflow, InvalidAmount, Liquidity }

fn mul_div(a: u64, b: u64, d: u64) -> Result<u64, MathError> {
    let n = (a as u128).checked_mul(b as u128).ok_or(MathError::Overflow)?;
    let result = n.checked_div(d as u128).ok_or(MathError::Overflow)?;
    u64::try_from(result).map_err(|_| MathError::Overflow)
}
pub fn fee(amount: u64) -> Result<u64, MathError> { mul_div(amount, FEE_BPS, BPS) }

pub fn buy(native: u64, tokens: u64, input: u64) -> Result<(u64, u64), MathError> {
    if input == 0 || tokens == 0 { return Err(MathError::InvalidAmount); }
    let fees = fee(input)?;
    let net = input.checked_sub(fees).ok_or(MathError::Overflow)?;
    let denominator = VIRTUAL_NATIVE.checked_add(native).and_then(|n| n.checked_add(net)).ok_or(MathError::Overflow)?;
    let out = mul_div(tokens, net, denominator)?; // floor output, never ceil
    if out == 0 || out >= tokens { return Err(MathError::Liquidity); }
    Ok((out, fees))
}
pub fn sell(native: u64, tokens: u64, input: u64) -> Result<(u64, u64), MathError> {
    if input == 0 || tokens == 0 { return Err(MathError::InvalidAmount); }
    let denominator = tokens.checked_add(input).ok_or(MathError::Overflow)?;
    if denominator > SUPPLY { return Err(MathError::Liquidity); }
    let priced = VIRTUAL_NATIVE.checked_add(native).ok_or(MathError::Overflow)?;
    let gross = mul_div(priced, input, denominator)?;
    if gross == 0 || gross > native { return Err(MathError::Liquidity); }
    Ok((gross, fee(gross)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_preserves_inventory_and_cannot_profit() {
        for amount in [1_000, 1_000_000, 1_000_000_000, 50_000_000_000] {
            let (out, buy_fee) = buy(0, SUPPLY, amount).unwrap();
            let reserve = amount - buy_fee;
            let (gross, sell_fee) = sell(reserve, SUPPLY-out, out).unwrap();
            assert!(gross <= reserve);
            assert!(gross-sell_fee < amount);
            assert_eq!((SUPPLY-out)+out, SUPPLY);
            let k_before = (VIRTUAL_NATIVE as u128) * SUPPLY as u128;
            let k_after = (VIRTUAL_NATIVE as u128+reserve as u128)*(SUPPLY-out) as u128;
            assert!(k_after >= k_before);
        }
    }
    #[test]
    fn rejects_unbacked_sells_and_overflow() {
        assert_eq!(sell(0, SUPPLY, 1), Err(MathError::Liquidity));
        assert_eq!(buy(u64::MAX, SUPPLY, 1), Err(MathError::Overflow));
        assert_eq!(buy(0, SUPPLY, 0), Err(MathError::InvalidAmount));
        assert_eq!(sell(1, u64::MAX, 1), Err(MathError::Overflow));
    }
    #[test]
    fn many_trades_conserve_supply_and_backing() {
        let (mut native, mut tokens, mut held) = (0u64, SUPPLY, 0u64);
        for i in 1..=1000u64 {
            let input = i*7919+10000;
            let (out, f) = buy(native, tokens, input).unwrap();
            native = native.checked_add(input-f).unwrap();
            tokens -= out; held += out;
            let old_k = (VIRTUAL_NATIVE as u128+native as u128)*tokens as u128;
            let sold = held/3;
            let (gross, _) = sell(native, tokens, sold).unwrap();
            native -= gross; tokens += sold; held -= sold;
            assert_eq!(tokens+held, SUPPLY);
            assert!((VIRTUAL_NATIVE as u128+native as u128)*tokens as u128 >= old_k);
        }
    }
}
