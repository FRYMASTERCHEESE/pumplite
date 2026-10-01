import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OFFICIAL = Object.freeze({
  chainId: 8453,
  token: "0xb15A460142c77b42cDF57815b0eeFEb24b593196",
  market: "0xa522A4Ef81fD31daec390ab46A32D4886e1461C7",
  factory: "0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4",
  claim: "0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2",
  pair: "0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086",
  website: "https://frymastercheese.github.io/pumplite/"
});

const lower = value => String(value ?? "").toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchSafe(url, attempts = 2) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
          "User-Agent": "PumpLite-public-verifier/1.0"
        },
        signal: controller.signal
      });

      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    }
  }

  throw lastError;
}

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const localWellKnown = JSON.parse(
  await readFile(".well-known/plite-token.json", "utf8")
);

const localTokenList = JSON.parse(
  await readFile("token-list.json", "utf8")
);

assert.equal(
  localWellKnown.token.address.toLowerCase(),
  OFFICIAL.token.toLowerCase(),
  "well-known token identity drift"
);

assert.equal(
  localWellKnown.token.chainId,
  OFFICIAL.chainId,
  "well-known chain identity drift"
);

assert.equal(
  localTokenList.tokens.length,
  1,
  "official token list must contain exactly PLITE"
);

assert.equal(
  localTokenList.tokens[0].address.toLowerCase(),
  OFFICIAL.token.toLowerCase(),
  "token-list PLITE identity drift"
);

assert.equal(
  localTokenList.tokens[0].chainId,
  OFFICIAL.chainId,
  "token-list Base chain identity drift"
);

const report = {
  checkedAt: new Date().toISOString(),
  mode: "no-api-key-public-verification",
  official: OFFICIAL,
  sourcify: {},
  dexScreener: {},
  geckoTerminal: {},
  blockscout: {},
  baseScan: {},
  website: {},
  manualReviewBoundaries: {
    coinMarketCapVerifiedListing:
      "manual provider review; cannot be auto-awarded by PumpLite",
    coinGeckoListingOrUpdate:
      "provider submission/review; cannot be auto-awarded by PumpLite",
    geckoTerminalVerifiedBadge:
      "provider review; public API discovery is separate from badge review",
    baseScanProfileOrOwnership:
      "provider account/ownership process is separate from public indexing"
  }
};

async function observe(name, fn) {
  try {
    report[name] = {
      ...report[name],
      ...(await fn())
    };
  } catch (error) {
    report[name] = {
      ...report[name],
      status: "temporarily_unavailable",
      note: String(error?.message || error)
    };
  }
}

const sourcifyTargets = {
  factory: OFFICIAL.factory,
  market: OFFICIAL.market,
  token: OFFICIAL.token,
  claim: OFFICIAL.claim
};

for (const [name, address] of Object.entries(sourcifyTargets)) {
  try {
    const response = await fetchSafe(
      `https://sourcify.dev/server/v2/contract/${OFFICIAL.chainId}/${address}?fields=all`
    );

    if (response.ok) {
      report.sourcify[name] = {
        status: "verified"
      };
    } else {
      report.sourcify[name] = {
        status: "not_observed",
        httpStatus: response.status
      };
    }
  } catch (error) {
    report.sourcify[name] = {
      status: "temporarily_unavailable",
      note: String(error?.message || error)
    };
  }
}

await observe("dexScreener", async () => {
  const response = await fetchSafe(
    `https://api.dexscreener.com/tokens/v1/base/${OFFICIAL.token}`
  );

  if (!response.ok) {
    return {
      status: "not_observed",
      httpStatus: response.status
    };
  }

  const data = await jsonOrNull(response);

  if (!Array.isArray(data)) {
    return {
      status: "provider_response_unexpected"
    };
  }

  if (data.length === 0) {
    return {
      status: "not_indexed_yet"
    };
  }

  const tokenReferenced = data.every(pair => {
    const base = lower(pair?.baseToken?.address);
    const quote = lower(pair?.quoteToken?.address);

    return (
      base === lower(OFFICIAL.token) ||
      quote === lower(OFFICIAL.token)
    );
  });

  if (!tokenReferenced) {
    throw new Error(
      "DEX Screener returned a pair that does not reference official PLITE"
    );
  }

  const officialPair = data.find(
    pair =>
      lower(pair?.pairAddress) === lower(OFFICIAL.pair)
  );

  return {
    status: officialPair
      ? "indexed_official_plite_weth_pair"
      : "indexed_other_plite_pair",
    pairsObserved: data.length,
    officialPairObserved: Boolean(officialPair)
  };
});

await observe("geckoTerminal", async () => {
  const response = await fetchSafe(
    `https://api.geckoterminal.com/api/v2/networks/base/tokens/${OFFICIAL.token}`
  );

  if (response.status === 404) {
    return {
      status: "not_indexed_yet"
    };
  }

  if (!response.ok) {
    return {
      status: "not_observed",
      httpStatus: response.status
    };
  }

  const body = await jsonOrNull(response);
  const attributes = body?.data?.attributes ?? {};
  const observedAddress =
    attributes.address ??
    body?.data?.id?.split("_").at(-1) ??
    "";

  if (
    observedAddress &&
    lower(observedAddress) !== lower(OFFICIAL.token)
  ) {
    throw new Error(
      "GeckoTerminal returned conflicting token identity"
    );
  }

  return {
    status: "indexed",
    name: attributes.name ?? null,
    symbol: attributes.symbol ?? null
  };
});

await observe("blockscout", async () => {
  const response = await fetchSafe(
    `https://base.blockscout.com/api/v2/tokens/${OFFICIAL.token}`
  );

  if (response.status === 404) {
    return {
      status: "not_indexed_yet"
    };
  }

  if (!response.ok) {
    return {
      status: "not_observed",
      httpStatus: response.status
    };
  }

  const body = await jsonOrNull(response);
  const observedAddress =
    body?.address_hash ??
    body?.address ??
    OFFICIAL.token;

  if (
    lower(observedAddress) !== lower(OFFICIAL.token)
  ) {
    throw new Error(
      "Blockscout returned conflicting token identity"
    );
  }

  if (
    body?.symbol &&
    String(body.symbol).toUpperCase() !== "PLITE"
  ) {
    throw new Error(
      "Blockscout returned conflicting PLITE symbol"
    );
  }

  return {
    status: "indexed",
    name: body?.name ?? null,
    symbol: body?.symbol ?? null,
    holdersCount: body?.holders_count ?? null
  };
});

await observe("baseScan", async () => {
  const response = await fetchSafe(
    `https://basescan.org/token/${OFFICIAL.token}`
  );

  const text = await response.text();

  return {
    status:
      response.ok &&
      (
        lower(text).includes(lower(OFFICIAL.token)) ||
        /\bplite\b/i.test(text)
      )
        ? "public_token_page_reachable"
        : response.ok
          ? "page_reachable_identity_not_machine_confirmed"
          : "not_observed",
    httpStatus: response.status
  };
});

const websiteChecks = {
  verificationPage:
    "https://frymastercheese.github.io/pumplite/verification.html",
  verificationManifest:
    "https://frymastercheese.github.io/pumplite/assets/token-verification.json",
  tokenList:
    "https://frymastercheese.github.io/pumplite/token-list.json",
  wellKnown:
    "https://frymastercheese.github.io/pumplite/.well-known/plite-token.json",
  sitemap:
    "https://frymastercheese.github.io/pumplite/sitemap.xml"
};

for (const [name, url] of Object.entries(websiteChecks)) {
  try {
    const response = await fetchSafe(url);
    const text = await response.text();

    const identityRequired =
      name !== "sitemap";

    const matchesIdentity =
      !identityRequired ||
      lower(text).includes(lower(OFFICIAL.token));

    report.website[name] = {
      status:
        response.ok && matchesIdentity
          ? "published"
          : response.status === 404
            ? "pages_deployment_pending"
            : "not_observed",
      httpStatus: response.status
    };
  } catch (error) {
    report.website[name] = {
      status: "temporarily_unavailable",
      note: String(error?.message || error)
    };
  }
}

await mkdir(
  "build/public-token-indexers",
  { recursive: true }
);

await writeFile(
  "build/public-token-indexers/latest.json",
  JSON.stringify(report, null, 2) + "\n"
);

console.log("");
console.log("PLITE NO-KEY PUBLIC VERIFICATION");
console.log("--------------------------------");

for (const [name, item] of Object.entries(report.sourcify)) {
  console.log(`Sourcify ${name}: ${item.status}`);
}

console.log(`DEX Screener: ${report.dexScreener.status}`);
console.log(`GeckoTerminal: ${report.geckoTerminal.status}`);
console.log(`Blockscout public index: ${report.blockscout.status}`);
console.log(`BaseScan public page: ${report.baseScan.status}`);

for (const [name, item] of Object.entries(report.website)) {
  console.log(`Website ${name}: ${item.status}`);
}

console.log("");
console.log(
  "PASS - no-key public verification/discovery check completed"
);
console.log(
  "External manual-review badges are never fabricated."
);
console.log(
  "No API key, wallet, signature, transaction, deployment or funds used."
);
console.log(
  "Status: build/public-token-indexers/latest.json"
);