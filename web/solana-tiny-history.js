const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) return null;
  let n = 0n;
  for (const ch of value) {
    const digit = B58.indexOf(ch);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  let body = [];
  if (n !== 0n) {
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    body = Array.from(Uint8Array.from(hex.match(/../g).map(x => Number.parseInt(x, 16))));
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros++;
  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

function u64(bytes, offset) {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) + BigInt(bytes[offset + i]);
  return value;
}

function keyText(value) {
  if (!value) return '';
  const key = value.pubkey ?? value;
  if (typeof key === 'string') return key;
  if (typeof key?.toBase58 === 'function') return key.toBase58();
  return String(key);
}

function tokenAmount(meta, field, accountIndex, mint) {
  const list = Array.isArray(meta?.[field]) ? meta[field] : [];
  const row = list.find(item =>
    item?.accountIndex === accountIndex &&
    item?.mint === mint
  );
  const amount = row?.uiTokenAmount?.amount;
  return typeof amount === 'string' && /^\d+$/.test(amount) ? BigInt(amount) : 0n;
}

export function parseTinyTradeTransaction(transaction, {
  programId,
  mint,
  market,
  treasury,
  decimals = 6
}) {
  if (
    !transaction ||
    transaction.meta?.err !== null ||
    !Number.isSafeInteger(transaction.slot) ||
    transaction.slot < 0
  ) return null;

  const message = transaction.transaction?.message;
  const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys.map(keyText) : [];
  const instructions = Array.isArray(message?.instructions) ? message.instructions : [];

  const ix = instructions.find(item =>
    keyText(item?.programId) === programId &&
    typeof item?.data === 'string'
  );
  if (!ix) return null;

  const accounts = Array.isArray(ix.accounts) ? ix.accounts.map(keyText) : [];
  if (
    accounts.length < 5 ||
    accounts[1] !== market ||
    accounts[2] !== mint ||
    accounts[4] !== treasury
  ) return null;

  const data = decodeBase58(ix.data);
  if (!data || data.length !== 17 || ![0, 1].includes(data[0])) return null;

  const input = u64(data, 1);
  const minimum = u64(data, 9);
  if (input <= 0n || minimum <= 0n) return null;

  const traderTokens = accounts[3];
  const tokenIndex = accountKeys.indexOf(traderTokens);
  const marketIndex = accountKeys.indexOf(market);
  if (tokenIndex < 0 || marketIndex < 0) return null;

  const preToken = tokenAmount(transaction.meta, 'preTokenBalances', tokenIndex, mint);
  const postToken = tokenAmount(transaction.meta, 'postTokenBalances', tokenIndex, mint);
  const preNative = transaction.meta?.preBalances?.[marketIndex];
  const postNative = transaction.meta?.postBalances?.[marketIndex];

  if (
    !Number.isSafeInteger(preNative) ||
    !Number.isSafeInteger(postNative) ||
    preNative < 0 ||
    postNative < 0
  ) return null;

  const isBuy = data[0] === 0;
  let output;
  let nativeGross;

  if (isBuy) {
    if (postToken <= preToken) return null;
    output = postToken - preToken;
    nativeGross = input;
  } else {
    if (preToken <= postToken || preNative <= postNative) return null;
    if (preToken - postToken !== input) return null;
    nativeGross = BigInt(preNative - postNative);
    const fee = nativeGross / 400n;
    output = nativeGross - fee;
    if (output <= 0n) return null;
  }

  const fee = nativeGross / 400n;
  const tokenAmountForPrice = isBuy ? output : input;
  const nativeAmountForPrice = isBuy ? input : output;
  const price =
    nativeAmountForPrice *
    10n ** BigInt(decimals) /
    tokenAmountForPrice;

  if (price <= 0n) return null;

  const signature = transaction.transaction?.signatures?.[0];
  if (typeof signature !== 'string') return null;

  return {
    blockNumber: transaction.slot,
    timestamp:
      Number.isFinite(Number(transaction.blockTime))
        ? Number(transaction.blockTime)
        : null,
    transactionHash: signature,
    isBuy,
    input,
    output,
    nativeGross,
    fee,
    price
  };
}
