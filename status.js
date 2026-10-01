const TOKEN =
  "0xb15A460142c77b42cDF57815b0eeFEb24b593196";
const PAIR =
  "0xDAD81f9f5DbF71Ce54D63f96eE45231D97d6B086";

const $ = id => document.getElementById(id);

function setState(id, value, state = "neutral") {
  const node = $(id);
  node.textContent = value;
  node.dataset.state = state;
}

async function fetchJson(url, maxBytes = 524288) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null
      };
    }

    const length = Number(
      response.headers.get("content-length") || 0
    );

    if (length > maxBytes) {
      throw Error("Provider response exceeds size limit");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > maxBytes) {
      throw Error("Provider response exceeds size limit");
    }

    const text = new TextDecoder().decode(bytes);

    return {
      ok: true,
      status: response.status,
      data: JSON.parse(text)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkSourcify() {
  try {
    const result = await fetchJson(
      `https://sourcify.dev/server/v2/contract/8453/${TOKEN}?fields=all`
    );

    setState(
      "sourcify-status",
      result.ok ? "Source verified" : "Not observed",
      result.ok ? "good" : "pending"
    );

    return result.ok;
  } catch {
    setState(
      "sourcify-status",
      "Temporarily unavailable",
      "pending"
    );

    return false;
  }
}

async function checkDexScreener() {
  try {
    const result = await fetchJson(
      `https://api.dexscreener.com/tokens/v1/base/${TOKEN}`
    );

    const pairs = Array.isArray(result.data)
      ? result.data
      : [];

    const official = pairs.some(
      item =>
        String(item?.pairAddress || "").toLowerCase() ===
        PAIR.toLowerCase()
    );

    setState(
      "dex-status",
      official
        ? "Official pair indexed"
        : pairs.length
          ? "PLITE indexed"
          : "Not indexed yet",
      official || pairs.length ? "good" : "pending"
    );

    return official || pairs.length > 0;
  } catch {
    setState(
      "dex-status",
      "Temporarily unavailable",
      "pending"
    );

    return false;
  }
}

async function checkGeckoTerminal() {
  try {
    const result = await fetchJson(
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${TOKEN}`
    );

    const observed =
      result.data?.data?.attributes?.address ||
      String(result.data?.data?.id || "").split("_").at(-1);

    const matches =
      result.ok &&
      String(observed || TOKEN).toLowerCase() ===
        TOKEN.toLowerCase();

    setState(
      "gecko-status",
      matches ? "Indexed" : "Not indexed yet",
      matches ? "good" : "pending"
    );

    return matches;
  } catch {
    setState(
      "gecko-status",
      "Temporarily unavailable",
      "pending"
    );

    return false;
  }
}

async function checkBlockscout() {
  try {
    const result = await fetchJson(
      `https://base.blockscout.com/api/v2/tokens/${TOKEN}`
    );

    const symbol =
      String(result.data?.symbol || "").toUpperCase();

    const matches =
      result.ok &&
      (
        !symbol ||
        symbol === "PLITE"
      );

    setState(
      "blockscout-status",
      matches ? "Indexed" : "Not indexed yet",
      matches ? "good" : "pending"
    );

    return matches;
  } catch {
    setState(
      "blockscout-status",
      "Temporarily unavailable",
      "pending"
    );

    return false;
  }
}

async function checkWebsite() {
  try {
    const [manifest, list] = await Promise.all([
      fetchJson("./assets/token-verification.json", 262144),
      fetchJson("./token-list.json", 262144)
    ]);

    const manifestToken =
      manifest.data?.token?.address;

    const listToken =
      list.data?.tokens?.[0]?.address;

    const matches =
      manifest.ok &&
      list.ok &&
      String(manifestToken || "").toLowerCase() ===
        TOKEN.toLowerCase() &&
      String(listToken || "").toLowerCase() ===
        TOKEN.toLowerCase();

    setState(
      "website-status",
      matches
        ? "Official evidence published"
        : "Evidence mismatch",
      matches ? "good" : "bad"
    );

    return matches;
  } catch {
    setState(
      "website-status",
      "Temporarily unavailable",
      "pending"
    );

    return false;
  }
}

let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;

  $("refresh-status").disabled = true;
  $("status-summary").textContent =
    "Refreshing read-only public verification checks...";

  try {
    const results = await Promise.all([
      checkSourcify(),
      checkDexScreener(),
      checkGeckoTerminal(),
      checkBlockscout(),
      checkWebsite()
    ]);

    const available = results.filter(Boolean).length;

    $("status-summary").textContent =
      `${available} of ${results.length} public evidence/indexing checks are currently confirmed. Provider outages or pending indexing do not change PLITE's on-chain identity.`;

    $("last-checked").textContent =
      "Last checked: " +
      new Date().toLocaleString();
  } finally {
    refreshing = false;
    $("refresh-status").disabled = false;
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box);
  box.select();

  const copied = document.execCommand("copy");
  box.remove();

  if (!copied) throw Error("Copy unavailable");
}

$("copy-token").addEventListener("click", async () => {
  try {
    await copyText(TOKEN);
    $("status-summary").textContent =
      "Official PLITE Base token address copied.";
  } catch {
    $("status-summary").textContent =
      "Copy was blocked by this browser. Select the address above to copy it manually.";
  }
});

$("share-token").addEventListener("click", async () => {
  const data = {
    title: "Official PLITE verification",
    text: `PumpLite (PLITE) on Base: ${TOKEN}`,
    url: new URL("./verification.html", location.href).href
  };

  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }

    await copyText(
      `${data.text}\n${data.url}`
    );

    $("status-summary").textContent =
      "Official PLITE verification link copied.";
  } catch (error) {
    if (error?.name !== "AbortError") {
      $("status-summary").textContent =
        "Sharing was unavailable. You can copy the official token address above.";
    }
  }
});

$("refresh-status").addEventListener(
  "click",
  () => void refresh()
);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});

void refresh();

window.setInterval(() => {
  if (!document.hidden) void refresh();
}, 60000);