import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  readFile
} from "node:fs/promises";

test(
  "simulation playground is removed",
  async () => {
    await assert.rejects(
      access(
        "mayhem-playground.html"
      )
    );

    await assert.rejects(
      access(
        "web/mayhem-playground.js"
      )
    );

    const index =
      await readFile(
        "index.html",
        "utf8"
      );

    assert.doesNotMatch(
      index,
      /mayhem-playground/i
    );

    assert.match(
      index,
      /href="\.\/v3-deploy\.html"/
    );
  }
);

test(
  "real V3 page clearly identifies Base Mainnet deployment and never asks for wallet secrets",
  async () => {
    const html =
      await readFile(
        "v3-deploy.html",
        "utf8"
      );

    assert.match(
      html,
      /REAL BASE MAINNET/
    );

    assert.match(
      html,
      /REAL TRANSACTION/
    );

    assert.match(
      html,
      /Never enter a seed phrase or private key/
    );

    assert.match(
      html,
      /Mayhem controller public Base address/
    );

    assert.doesNotMatch(
      html,
      /simulation only/i
    );

    for (const forbidden of [
      'type="password"',
      "private key input",
      "seed phrase input",
      "mnemonic"
    ]) {
      assert.equal(
        html.toLowerCase().includes(
          forbidden.toLowerCase()
        ),
        false
      );
    }
  }
);

test(
  "real V3 deployment uses wallet approval and verifies deployed factory read-back",
  async () => {
    const source =
      await readFile(
        "web/v3-deploy.js",
        "utf8"
      );

    for (const required of [
      "eth_requestAccounts",
      "wallet_switchEthereumChain",
      "ContractFactory",
      "estimateGas",
      "factory.deploy",
      "tx.wait",
      "mayhemController",
      "mayhemFeeTreasury",
      "marketCount",
      "maskImmutables",
      "Base Mainnet"
    ]) {
      assert.ok(
        source.includes(required),
        "missing real deployment behavior: " +
          required
      );
    }

    for (const forbidden of [
      "privateKey",
      "mnemonic",
      "seedPhrase",
      "eth_sendRawTransaction",
      "localStorage",
      "sessionStorage"
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        "deployment page must not contain: " +
          forbidden
      );
    }
  }
);

test(
  "production remains V2 until separately verified activation",
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