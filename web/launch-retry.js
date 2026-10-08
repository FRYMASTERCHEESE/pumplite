// Public signed launch envelopes only. Never persist a mint keypair or a transaction.
export function publicLaunchRetryCache(storage) {
  const pending = new Map();
  const values = new Map();
  return {
    async get(key, create) {
      if (pending.has(key)) return pending.get(key);
      if (values.has(key)) return structuredClone(values.get(key));
      const task = (async () => {
        let draft;
        try { draft = JSON.parse(storage?.getItem('pumplite.launch.' + key) || 'null'); } catch {}
        if (!draft) draft = await create();
        // Envelopes are still fully validated by the service; browser storage is not authority.
        values.set(key, draft);
        try { storage?.setItem('pumplite.launch.' + key, JSON.stringify(draft)); } catch {}
        return structuredClone(draft);
      })();
      pending.set(key, task);
      try { return await task; } finally { pending.delete(key); }
    }
  };
}
export async function launchStage(label, action) {
  try { return await action(); }
  catch (error) {
    const rejected = error?.code === 4001 || /reject|denied/i.test(error?.message || '');
    const detail = rejected ? 'Phantom rejected the signature' :
      /fetch|network|timeout|abort/i.test(error?.message || '') ? 'Service unavailable or timed out' : (error?.message || 'Request failed');
    throw new Error(label + ': ' + detail, { cause: error });
  }
}
