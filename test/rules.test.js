/**
 * Firebase Realtime Database security rules unit tests.
 *
 * Prerequisites:
 *   1. `firebase emulators:start --only database` running on localhost:9000
 *   2. Java 11+ installed (required by the Firebase emulator)
 *
 * Run: npm run test:rules
 */

import { beforeAll, afterAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, serverTimestamp } from 'firebase/database';
import { readFileSync } from 'fs';

const RULES = readFileSync('./database.rules.json', 'utf8');

let testEnv;
let hhCounter = 0;

// Unique household ID per test so stateful tests never step on each other.
function freshHhId() {
  return `hh-test-${++hhCounter}`;
}

function db(ctx) {
  return ctx.database();
}

/** Log documents written by `src/logger.js` to RTDB: `data` is a JSON string (50k cap in rules). */
function validLogEntry(overrides = {}) {
  return {
    timestamp: Date.now(),
    sessionId: 'session_test_1',
    level: 'info',
    category: 'Test',
    message: 'ok',
    data: '{}',
    url: 'https://example.com/',
    userAgent: 'RulesUnitTest/1.0',
    serverTimestamp: serverTimestamp(),
    ...overrides,
  };
}

async function seedUser(uid, householdId) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(db(ctx), `/users/${uid}`), {
      email: `${uid}@test.com`,
      displayName: uid,
      householdId,
      createdAt: 0,
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-larder',
    database: {
      rules: RULES,
      host: 'localhost',
      port: 9000,
    },
  });

  // Seed two users in fixed households for isolation tests.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(db(ctx), '/users/alice'), {
      email: 'alice@test.com', displayName: 'Alice', householdId: 'hh-alice', createdAt: 0,
    });
    await set(ref(db(ctx), '/users/bob'), {
      email: 'bob@test.com', displayName: 'Bob', householdId: 'hh-bob', createdAt: 0,
    });
  });
});

afterAll(() => testEnv?.cleanup());

// ---------------------------------------------------------------------------
// User record isolation
// ---------------------------------------------------------------------------

describe('user records', () => {
  it('owner can read their own user record', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertSucceeds(get(ref(db(ctx), '/users/alice')));
  });

  it('user cannot read another user record', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(get(ref(db(ctx), '/users/bob')));
  });

  it('unauthenticated user cannot read any user record', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(get(ref(db(ctx), '/users/alice')));
  });

  it('owner can write their own user record', async () => {
    const hhId = freshHhId();
    const uid = `user-write-${hhId}`;
    const ctx = testEnv.authenticatedContext(uid);
    // First write (record doesn't exist) should succeed.
    await assertSucceeds(
      set(ref(db(ctx), `/users/${uid}`), {
        email: `${uid}@test.com`, displayName: uid, householdId: hhId, createdAt: 0,
      })
    );
  });

  it('user cannot write to another user record', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(
      set(ref(db(ctx), '/users/bob'), {
        email: 'hack@test.com', displayName: 'Hacked', householdId: 'hh-alice', createdAt: 0,
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Household isolation
// ---------------------------------------------------------------------------

describe('household isolation', () => {
  it('member can read their own household', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), '/households/hh-alice/adminUid'), 'alice');
    });
    const ctx = testEnv.authenticatedContext('alice');
    await assertSucceeds(get(ref(db(ctx), '/households/hh-alice/adminUid')));
  });

  it('member cannot read another household', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), '/households/hh-bob/adminUid'), 'bob');
    });
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(get(ref(db(ctx), '/households/hh-bob/adminUid')));
  });

  it('member can write to their own household', async () => {
    const hhId = freshHhId();
    const uid = `member-${hhId}`;
    await seedUser(uid, hhId);
    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(
      set(ref(db(ctx), `/households/${hhId}/adminUid`), uid)
    );
  });

  it('member cannot write to another household', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(
      set(ref(db(ctx), '/households/hh-bob/shopping-list'), 'owned by alice')
    );
  });

  it('unauthenticated user cannot read any household', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(get(ref(db(ctx), '/households/hh-alice/adminUid')));
  });
});

// ---------------------------------------------------------------------------
// shopping-list + subscriptionUpdatedAt field validation
// ---------------------------------------------------------------------------

describe('household data size / shape', () => {
  const validListItem = {
    id: 'item-abc-123',
    itemKey: 'item-abc-123',
    name: 'Milk',
    category: 'Dairy',
    categoryId: 'cat-1',
    quantity: '1',
    done: false,
    addedBy: 'member-1',
    addedAt: 0,
    updatedAt: 0,
    updatedBy: 'member-1',
  };

  it('member can write subscriptionUpdatedAt', async () => {
    const hhId = freshHhId();
    const uid = `sub-${hhId}`;
    await seedUser(uid, hhId);
    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(
      set(ref(db(ctx), `/households/${hhId}/subscriptionUpdatedAt`), Date.now())
    );
  });

  it('member can write a well-formed shopping list item', async () => {
    const hhId = freshHhId();
    const uid = `list-${hhId}`;
    await seedUser(uid, hhId);
    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(
      set(ref(db(ctx), `/households/${hhId}/shopping-list/${validListItem.id}`), validListItem)
    );
  });

  it('rejects extra keys on a shopping list item', async () => {
    const hhId = freshHhId();
    const uid = `list-bad-${hhId}`;
    await seedUser(uid, hhId);
    const ctx = testEnv.authenticatedContext(uid);
    await assertFails(
      set(ref(db(ctx), `/households/${hhId}/shopping-list/bad-1`), {
        ...validListItem,
        id: 'bad-1',
        itemKey: 'bad-1',
        badPayload: 'nope',
      })
    );
  });
});

// In RTDB, a parent .write grant cascades to all children — a child .write
// cannot revoke it. The write-once constraint is enforced via .validate
// instead: "!data.exists() || data.val() == newData.val()" which fires after
// write permission is granted and rejects any value change.
// ---------------------------------------------------------------------------

describe('trialEndsAt write-once', () => {
  it('member can write trialEndsAt when it does not exist', async () => {
    const hhId = freshHhId();
    const uid = `trial-user-${hhId}`;
    await seedUser(uid, hhId);
    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(
      set(ref(db(ctx), `/households/${hhId}/trialEndsAt`), Date.now() + 1_000_000)
    );
  });

  it('member cannot overwrite an existing trialEndsAt', async () => {
    const hhId = freshHhId();
    const uid = `trial-user-${hhId}`;
    await seedUser(uid, hhId);

    // Seed an existing trialEndsAt via admin bypass.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/households/${hhId}/trialEndsAt`), 12345);
    });

    const ctx = testEnv.authenticatedContext(uid);
    await assertFails(
      set(ref(db(ctx), `/households/${hhId}/trialEndsAt`), Date.now() + 9_999_999)
    );
  });
});

// ---------------------------------------------------------------------------
// Global invite-code index (/inviteCodes)
// ---------------------------------------------------------------------------

describe('global invite codes', () => {
  const CODE = 'AAAA1111BBBB2222'; // 16-char alphanumeric

  it('unauthenticated user can read the invite code index', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/inviteCodes/${CODE}`), {
        householdId: 'hh-alice',
        expiresAt: '2099-01-01',
        used: false,
        createdAt: 0,
      });
    });
    const ctx = testEnv.unauthenticatedContext();
    await assertSucceeds(get(ref(db(ctx), `/inviteCodes/${CODE}`)));
  });

  it('household member can write an invite code for their own household', async () => {
    const hhId = freshHhId();
    const uid = `invite-user-${hhId}`;
    await seedUser(uid, hhId);
    const code = `INVITE${hhId.replace(/-/g, '').toUpperCase().slice(0, 10)}`;
    const paddedCode = code.padEnd(16, '0').slice(0, 16);

    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(
      set(ref(db(ctx), `/inviteCodes/${paddedCode}`), {
        householdId: hhId,
        expiresAt: '2099-01-01',
        used: false,
        createdAt: Date.now(),
      })
    );
  });

  it('member cannot write an invite code for a different household', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    const foreignCode = 'ZZZZ9999YYYY8888';
    await assertFails(
      set(ref(db(ctx), `/inviteCodes/${foreignCode}`), {
        householdId: 'hh-bob', // alice's householdId is hh-alice
        expiresAt: '2099-01-01',
        used: false,
        createdAt: Date.now(),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Logs isolation
// ---------------------------------------------------------------------------

describe('logs', () => {
  it('user can write their own logs', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      set(ref(db(ctx), '/logs/alice/session1/entry1'), validLogEntry())
    );
  });

  it('rejects log with non-string data (unbounded object payload)', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    const e = validLogEntry({ data: { not: 'allowed' } });
    await assertFails(
      set(ref(db(ctx), '/logs/alice/badData/entry1'), e)
    );
  });

  it('rejects log message over size cap', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(
      set(ref(db(ctx), '/logs/alice/sess/entry1'), validLogEntry({ message: 'x'.repeat(20001) }))
    );
  });

  it('user can read their own logs', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), '/logs/alice/session1/entry1'), validLogEntry());
    });
    const ctx = testEnv.authenticatedContext('alice');
    await assertSucceeds(get(ref(db(ctx), '/logs/alice')));
  });

  it('user cannot read another user logs', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(get(ref(db(ctx), '/logs/bob')));
  });

  it('unauthenticated user cannot read logs', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(get(ref(db(ctx), '/logs/alice')));
  });
});
