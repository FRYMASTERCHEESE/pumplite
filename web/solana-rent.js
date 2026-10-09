// Zero-data System-account rent support. All amounts are raw lamports.
export function rentSupport(native, gross, rent) {
  for (const value of [native,gross,rent]) if(typeof value!=='bigint'||value<0n||value>18446744073709551615n) throw Error('Invalid rent accounting');
  if(gross>native) throw Error('Insufficient curve backing');
  const remaining=native-gross;
  return remaining>0n&&remaining<rent ? rent-remaining : 0n;
}
export function minimumActivationGross(rent) {
  if(typeof rent!=='bigint'||rent<=0n||rent>18446744073709551615n) throw Error('Invalid activation rent floor');
  // Activation charges a 0.25% fee using integer division (gross/400).
  // Return a conservative gross amount whose net transfer keeps the new
  // zero-data market PDA rent-exempt.
  const gross=rent+(rent-1n)/399n;
  if(gross>18446744073709551615n) throw Error('Activation rent floor is too large');
  return gross;
}
export function requireRentConsent(required, minimum, consent) {
  if(required===0n)return;
  if(!consent || consent.accepted!==true || typeof consent.maximum!=='bigint' || consent.maximum<required) throw Error('Rent support changed or was not approved. Preview the sale and explicitly accept its rent cost.');
  if(required>=minimum)throw Error('Sale proceeds after rent support would be zero or negative. Use a smaller partial sale.');
}
