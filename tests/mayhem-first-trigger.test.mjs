import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAYHEM,
  MayhemStore
} from '../workers/pumplite-upload-guard/src/mayhem.js';

test(
  'first Manual Mayhem action is BUY with zero recorded inventory',
  () => {
    const now = 1000000;
    const launchId = 'a'.repeat(64);

    let state = {
      launchId,
      status: 'active',
      expiresAt: now + 60000,
      tradeCount: 0,
      solIn: 0,
      solOut: 0,
      inventory: '0'
    };

    let action = {
      id: 'request-1',
      launchId,
      status: 'accepted'
    };

    const mock = {
      atomic(fn) {
        return fn();
      },

      action(id) {
        assert.equal(id, 'request-1');
        return structuredClone(action);
      },

      state(id) {
        assert.equal(id, launchId);
        return structuredClone(state);
      },

      save(value) {
        state = structuredClone(value);
      },

      saveAction(value) {
        action = structuredClone(value);
      }
    };

    const decided =
      MayhemStore.prototype.decide.call(
        mock,
        'request-1',
        now
      );

    assert.equal(
      decided.side,
      'buy'
    );

    const amount =
      BigInt(decided.amount);

    assert.ok(
      amount >= BigInt(MAYHEM.minBuy)
    );

    assert.ok(
      amount <= BigInt(MAYHEM.maxBuy)
    );
  }
);