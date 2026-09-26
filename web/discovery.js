export function validateIndexPage(page, config, offset) {
  if (page?.schemaVersion !== 1 || page.programId !== config.programId || page.genesisHash !== config.genesisHash ||
      !Number.isSafeInteger(page.slot) || page.slot < 0 || !Array.isArray(page.markets) || page.markets.length > 8 ||
      new Set(page.markets).size !== page.markets.length || page.markets.some(k => typeof k !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k)) ||
      (page.next !== null && (page.next !== offset + 8 || page.markets.length !== 8))) throw Error('Invalid discovery index page');
  return page;
}
