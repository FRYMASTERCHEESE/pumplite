import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validatePublicConfig
} from "../web/release-config.js";

test(
  "production config rejects V3 until a reviewed V3 deployment is explicitly activated",
  async () => {
    const config = JSON.parse(
      await readFile(
        "config.json",
        "utf8"
      )
    );

    assert.equal(
      config.base.contractVersion,
      2
    );

    assert.doesNotThrow(
      () => validatePublicConfig(config)
    );

    const premature =
      structuredClone(config);

    premature.base.contractVersion = 3;

    assert.throws(
      () =>
        validatePublicConfig(
          premature
        ),
      /Unsupported Base contract version/
    );
  }
);
test(
  "V3 is additive and current production remains V2 until a reviewed deployment",
  async () => {
    const config = JSON.parse(
      await readFile(
        "config.json",
        "utf8"
      )
    );

    assert.equal(
      config.base.contractVersion,
      2
    );

    const source =
      await readFile(
        "contracts/base/v3/CurveMarketV3.sol",
        "utf8"
      );

    assert.match(
      source,
      /enum LaunchMode/
    );

    assert.match(
      source,
      /Classic/
    );

    assert.match(
      source,
      /MayhemAuto/
    );

    assert.match(
      source,
      /MayhemManual/
    );

    assert.match(
      source,
      /MAYHEM_DURATION = 24 hours/
    );

    assert.match(
      source,
      /event MayhemAgentTrade/
    );

    assert.match(
      source,
      /function finalizeMayhem/
    );

    assert.doesNotMatch(
      source,
      /function\s+(withdraw|setFee|setTreasury|upgradeTo|transferOwnership)\b/
    );
  }
);

test(
  "V3 UI offers Classic Auto and Manual only when V3 becomes the reviewed deployment",
  async () => {
    const html =
      await readFile(
        "index.html",
        "utf8"
      );

    const app =
      await readFile(
        "web/app.js",
        "utf8"
      );

    assert.match(
      html,
      /Classic - normal PumpLite market/
    );

    assert.match(
      html,
      /Mayhem Auto - autonomous agent cycle/
    );

    assert.match(
      html,
      /Mayhem Manual - creator requests each agent trade/
    );

    assert.match(
      app,
      /contractVersion === 3/
    );

    assert.match(
      app,
      /base-v3\.js/
    );

    assert.match(
      app,
      /agent activity is labeled separately from organic user trades/i
    );
  }
);

test(
  "V3 ABIs expose no owner withdrawal upgrade or fee mutation functions",
  async () => {
    const abis = JSON.parse(
      await readFile(
        "web/generated/base-v3-abi.json",
        "utf8"
      )
    );

    const forbidden = [
      "owner",
      "transferOwnership",
      "renounceOwnership",
      "withdraw",
      "withdrawETH",
      "withdrawNative",
      "setTreasury",
      "setFee",
      "pause",
      "unpause",
      "blacklist",
      "upgradeTo",
      "upgradeToAndCall",
      "mint"
    ];

    for (const [name, abi] of Object.entries(abis)) {
      const functions = abi
        .filter(item => item.type === "function")
        .map(item => item.name);

      for (const value of forbidden) {
        assert.ok(
          !functions.includes(value),
          name + " exposes forbidden function " + value
        );
      }
    }
  }
);

test(
  "V3 adapter keeps agent counters separate from organic volume",
  async () => {
    const adapter =
      await readFile(
        "web/adapters/base-v3.js",
        "utf8"
      );

    for (const field of [
      "agentInventory",
      "agentVolume",
      "agentNativeIn",
      "agentNativeOut",
      "mayhemTradeCount",
      "mayhemState"
    ]) {
      assert.ok(
        adapter.includes(field),
        "missing V3 field " + field
      );
    }
  }
);