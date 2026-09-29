export const BPS = 10_000n;
export const FEE = 25n;
export const SOL_SUPPLY = 1_000_000_000_000_000n;
export const BASE_SUPPLY = 1_000_000_000_000_000_000_000_000_000n;
export function parseUnits(text, decimals) {
  if (typeof text !== 'string' || text.length > 96) throw Error('Amount text exceeds supported integer size');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw Error('Invalid decimals');
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw Error('Enter a plain positive decimal amount');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw Error('Too many decimal places');
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (result <= 0n) throw Error('Amount must be greater than zero');
  return result;
}
export function formatUnits(value, decimals, places = 6) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
  return whole.toString() + (fraction ? '.' + fraction : '');
}
export function quote({ nativeReserve, tokenReserve, virtualNative, supply }, side, input) {
  if (input <= 0n || tokenReserve <= 0n || nativeReserve < 0n) throw Error('Invalid amount or market');
  let output, fee, gross;
  if (side === 'buy') {
    fee = input * FEE / BPS;
    const net = input - fee;
    output = tokenReserve * net / (virtualNative + nativeReserve + net);
    if (output >= tokenReserve) throw Error('Insufficient token inventory');
  } else if (side === 'sell') {
    if (input + tokenReserve > supply) throw Error('Amount exceeds circulating supply');
    gross = (virtualNative + nativeReserve) * input / (tokenReserve + input);
    if (gross > nativeReserve) throw Error('Insufficient real native reserves');
    fee = gross * FEE / BPS;
    output = gross - fee;
  } else throw Error('Invalid trade direction');
  if (output <= 0n) throw Error('Amount is too small');
  return { output, fee, gross };
}
export function minimumOutput(output, slippageBps) {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw Error('Slippage must be 0.01%–5%');
  const minimum = output * (BPS - BigInt(slippageBps)) / BPS;
  // Keep the smallest valid quote usable instead of inventing a PumpLite
  // minimum. The contract still requires a positive, nonzero output.
  return minimum > 0n ? minimum : 1n;
}
export function validateContentUri(uri, maxBytes = 200) {
  if (typeof uri !== 'string' || new TextEncoder().encode(uri).length > maxBytes) throw Error('Content URI exceeds its UTF-8 byte limit');
  if (!uri) return;
  if (/[\s\\]/u.test(uri) || /[\u0000-\u001f\u007f]/u.test(uri)) throw Error('Content URI contains whitespace or invalid characters');
  const url = new URL(uri);
  if (!['https:', 'ipfs:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash ||
      !(uri.startsWith('https://') || uri.startsWith('ipfs://'))) throw Error('Use a public HTTPS or IPFS content URI without credentials or fragments');
}
export function validateMetadata(name, symbol, uri) {
  if (typeof name !== 'string' || typeof symbol !== 'string') throw Error('Metadata name and symbol must be text');
  const bytes = text => new TextEncoder().encode(text).length;
  if (!name.trim() || bytes(name) > 32) throw Error('Name must be 1–32 UTF-8 bytes');
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw Error('Symbol must be 1–10 uppercase letters or digits');
  validateContentUri(uri);
}
export function assertReceipt(receipt) {
  if (!receipt || Number(receipt.status) !== 1) throw Error('Transaction failed on chain');
}
export function assertSolanaConfirmation(result) {
  if (!result || !result.value || result.value.err !== null) throw Error('Transaction failed on chain');
}


export const MAYHEM_SUPPORT_BPS = 75n;

export function quoteBaseV2(
  { nativeReserve, tokenReserve, virtualNative, supply, mayhemActive },
  side,
  input
) {
  if (input <= 0n || tokenReserve <= 0n || nativeReserve < 0n || supply <= 0n) {
    throw Error('Invalid amount or V2 market');
  }

  let output;
  let fee;
  let support = 0n;
  let gross;

  if (side === 'buy') {
    fee = input * FEE / BPS;
    if (mayhemActive) support = input * MAYHEM_SUPPORT_BPS / BPS;

    const curveInput = input - fee - support;
    if (curveInput <= 0n) throw Error('Amount is too small');

    output =
      tokenReserve *
      curveInput /
      (virtualNative + nativeReserve + curveInput);

    if (output <= 0n || output >= tokenReserve) {
      throw Error('Insufficient token inventory');
    }
  } else if (side === 'sell') {
    const outstanding = supply - tokenReserve;

    if (outstanding < 0n || input > outstanding) {
      throw Error('Amount exceeds circulating supply');
    }

    gross =
      (virtualNative + nativeReserve) *
      input /
      (tokenReserve + input);

    if (gross <= 0n || gross > nativeReserve) {
      throw Error('Insufficient real native reserves');
    }

    fee = gross * FEE / BPS;
    if (mayhemActive) support = gross * MAYHEM_SUPPORT_BPS / BPS;

    output = gross - fee - support;
    if (output <= 0n) throw Error('Amount is too small');
  } else {
    throw Error('Invalid trade direction');
  }

  return { output, fee, support, gross };
}
