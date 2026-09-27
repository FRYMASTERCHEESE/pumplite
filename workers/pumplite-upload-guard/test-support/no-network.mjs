// Unit suites must never contact a public RPC or provider.
globalThis.fetch = async () => { throw Error('External network disabled in unit tests'); };
