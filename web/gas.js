export function gasBudget(estimate, ceiling) {
  if (typeof estimate !== 'bigint' || estimate <= 0n) throw Error('Invalid gas estimate');
  const limit = (estimate * 12n + 9n) / 10n;
  if (limit > ceiling) throw Error('Gas estimate exceeds the reviewed execution budget');
  return limit;
}
