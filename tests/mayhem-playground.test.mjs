import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test(
  "Mayhem Playground is explicitly simulation-only and blocks network access",
  async () => {
    const html =
      await readFile(
        "mayhem-playground.html",
        "utf8"
      );

    assert.match(
      html,
      /SIMULATION ONLY/
    );

    assert.match(
      html,
      /No wallet connection/
    );

    assert.match(
      html,
      /No Base RPC/
    );

    assert.match(
      html,
      /No real ETH/
    );

    assert.match(
      html,
      /connect-src 'none'/
    );

    assert.match(
      html,
      /form-action 'none'/
    );

    assert.doesNotMatch(
      html,
      /Connect wallet/
    );
  }
);

test(
  "Mayhem Playground exposes Classic Auto Manual lifecycle controls",
  async () => {
    const html =
      await readFile(
        "mayhem-playground.html",
        "utf8"
      );

    for (const marker of [
      "Classic",
      "Mayhem Auto",
      "Mayhem Manual",
      "Simulate user BUY",
      "Simulate user SELL",
      "Run 1 Auto trade",
      "Start Auto",
      "Request Mayhem trade",
      "Execute randomized trade",
      "Fast-forward to 24h",
      "Finalize &amp; burn unused Mayhem inventory"
    ]) {
      assert.ok(
        html.includes(marker),
        "missing playground control: " +
          marker
      );
    }
  }
);

test(
  "Mayhem Playground JavaScript contains no wallet blockchain or network transaction APIs",
  async () => {
    const source =
      await readFile(
        "web/mayhem-playground.js",
        "utf8"
      );

    for (const forbidden of [
      "window.ethereum",
      "window.solana",
      "BrowserProvider",
      "JsonRpcProvider",
      "sendTransaction",
      "signTransaction",
      "eth_sendTransaction",
      "fetch(",
      "WebSocket",
      "XMLHttpRequest",
      "privateKey",
      "mnemonic",
      "seed phrase"
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        "playground must not contain: " +
          forbidden
      );
    }

    for (const required of [
      "organicVolume",
      "agentVolume",
      "agentTokens",
      "manualPending",
      "MAX_AGENT_TRADES",
      "MAYHEM_HOURS",
      "runAgentTrade",
      "finalize"
    ]) {
      assert.ok(
        source.includes(required),
        "missing playground behavior: " +
          required
      );
    }
  }
);

test(
  "production Base V2 configuration remains unchanged",
  async () => {
    const config =
      JSON.parse(
        await readFile(
          "config.json",
          "utf8"
        )
      );

    assert.equal(
      config.base.contractVersion,
      2
    );

    assert.equal(
      config.base.factory,
      "0xdA8c34819ae397FD4bE3C95947DEA64f4A3278f4"
    );

    assert.equal(
      config.base.transactionsEnabled,
      true
    );
  }
);