// Encode the public transaction signature returned by a wallet; never handles signing keys.
export function signatureText(signature) {
  if (!(signature instanceof Uint8Array) || signature.length !== 64 || !signature.some(n=>n!==0)) throw Error('Wallet returned no transaction signature');
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value=0n, result='', leading=0;
  for(const byte of signature)value=(value<<8n)+BigInt(byte);
  while(leading<signature.length&&signature[leading]===0)leading++;
  while(value>0n){result=alphabet[Number(value%58n)]+result;value/=58n;}
  return '1'.repeat(leading)+result;
}
