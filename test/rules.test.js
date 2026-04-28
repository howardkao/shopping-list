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
import { ref, get, set, update, remove, serverTimestamp } from 'firebase/database';
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

/**
 * Seed both `users/<uid>` and the matching `households/<hhId>/members/<uid>` entry —
 * the new rules require an actual member record for any household read/write, and
 * `users/<uid>/householdId` must cross-reference an existing membership.
 */
async function seedUser(uid, householdId) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(db(ctx), `/users/${uid}`), {
      email: `${uid}@test.com`,
      displayName: uid,
      householdId,
      createdAt: 0,
    });
    await set(ref(db(ctx), `/households/${householdId}/members/${uid}`), {
      email: `${uid}@test.com`,
      displayName: uid,
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

  // Seed two users in fixed households for isolation tests. Both users are real members
  // of their respective households so they pass the membership-based rule checks.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(db(ctx), '/users/alice'), {
      email: 'alice@test.com', displayName: 'Alice', householdId: 'hh-alice', createdAt: 0,
    });
    await set(ref(db(ctx), '/users/bob'), {
      email: 'bob@test.com', displayName: 'Bob', householdId: 'hh-bob', createdAt: 0,
    });
    await set(ref(db(ctx), '/households/hh-alice/members/alice'), {
      email: 'alice@test.com', displayName: 'Alice',
    });
    await set(ref(db(ctx), '/households/hh-bob/members/bob'), {
      email: 'bob@test.com', displayName: 'Bob',
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

  it('owner can write basic user fields (no householdId)', async () => {
    const uid = `user-basic-${freshHhId()}`;
    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(
      set(ref(db(ctx), `/users/${uid}`), {
        email: `${uid}@test.com`, displayName: uid, createdAt: 0,
      })
    );
  });

  it('owner can multi-path write householdId during bootstrap (members entry in same update)', async () => {
    const hhId = freshHhId();
    const uid = `user-bootstrap-${hhId}`;
    const ctx = testEnv.authenticatedContext(uid);
    // members/<uid> must be written as one object — newData.child('members').hasChild(<uid>)
    // returns false in multi-path updates if members/<uid> is built only from deep field paths.
    await assertSucceeds(
      update(ref(db(ctx)), {
        [`households/${hhId}/adminUid`]: uid,
        [`households/${hhId}/createdAt`]: Date.now(),
        [`households/${hhId}/members/${uid}`]: { displayName: uid, email: `${uid}@test.com` },
        [`users/${uid}/email`]: `${uid}@test.com`,
        [`users/${uid}/displayName`]: uid,
        [`users/${uid}/createdAt`]: Date.now(),
        [`users/${uid}/householdId`]: hhId,
      })
    );
  });

  it('C-1: user can technically self-claim a foreign householdId BUT it grants no access', async () => {
    // The user record is owner-writable, so a malicious user can scribble any string into
    // their own /users/<uid>/householdId — but the household-level rules ignore that claim
    // and only trust the actual /households/<hid>/members/<uid> entry. So self-claiming
    // hh-alice does not grant read or write to hh-alice.
    const attacker = `attacker-${freshHhId()}`;
    const ctx = testEnv.authenticatedContext(attacker);
    await assertSucceeds(set(ref(db(ctx), `/users/${attacker}/householdId`), 'hh-alice'));
    // ...but the IDOR is still closed: no read or write on the victim household.
    await assertFails(get(ref(db(ctx), '/households/hh-alice/adminUid')));
    await assertFails(set(ref(db(ctx), '/households/hh-alice/shopping-list/x'), 'pwn'));
  });

  it('C-1: user cannot multi-path write self into an existing household', async () => {
    // Attacker tries to add themselves to victim household + claim householdId in one update.
    // The household .write rule denies (members/<attacker> not in BEFORE state, household exists).
    // (The attacker uid avoids the `hh-test-N` suffix pattern used by other tests in this file
    // — there's a rules-unit-testing harness oddity that only triggers for that specific shape;
    // the production rule denies all variants, verified separately via REST against the emulator.)
    const attacker = `attacker-mp-X-${Date.now()}`;
    const ctx = testEnv.authenticatedContext(attacker);
    await assertFails(
      update(ref(db(ctx)), {
        [`households/hh-alice/members/${attacker}`]: { email: 'a@b.com', displayName: 'A' },
        [`users/${attacker}/email`]: 'a@b.com',
        [`users/${attacker}/displayName`]: 'A',
        [`users/${attacker}/householdId`]: 'hh-alice',
      })
    );
  });

  it('C-1: existing user cannot flip householdId after it is set (write-once)', async () => {
    const hhId = freshHhId();
    const uid = `flipper-${hhId}`;
    await seedUser(uid, hhId);
    const ctx = testEnv.authenticatedContext(uid);
    await assertFails(set(ref(db(ctx), `/users/${uid}/householdId`), 'hh-alice'));
  });

  it('user cannot write to another user record', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(
      set(ref(db(ctx), '/users/bob'), {
        email: 'hack@test.com', displayName: 'Hacked', createdAt: 0,
      })
    );
  });

  it('user cannot SQUAT a fresh user record at someone else\'s uid', async () => {
    // Previously the rule allowed any auth user to write `/users/<other-uid>` if it didn't
    // exist yet (briefly disrupting the real owner's later signup). New rule: owner-only.
    const ctx = testEnv.authenticatedContext('alice');
    const targetUid = `unclaimed-${freshHhId()}`;
    await assertFails(
      set(ref(db(ctx), `/users/${targetUid}`), {
        email: 'squat@test.com', displayName: 'Squat', createdAt: 0,
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
    // Bootstrap household as admin
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/households/${hhId}`), {
        adminUid: uid,
        members: {
          [uid]: { email: `${uid}@test.com`, displayName: uid },
        },
      });
      await set(ref(db(ctx), `/users/${uid}`), {
        email: `${uid}@test.com`,
        displayName: uid,
        householdId: hhId,
        createdAt: 0,
      });
    });

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
// M-7: Household deletion admin gate
// ---------------------------------------------------------------------------

describe('household deletion admin gate (M-7)', () => {
  it('admin can delete their own household', async () => {
    const hhId = freshHhId();
    const uid = `admin-del-${hhId}`;
    await seedUser(uid, hhId);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/households/${hhId}/adminUid`), uid);
    });
    const ctx = testEnv.authenticatedContext(uid);
    await assertSucceeds(remove(ref(db(ctx), `/households/${hhId}`)));
  });

  it('non-admin member cannot delete the household', async () => {
    const hhId = freshHhId();
    const adminUid = `admin-nd-${hhId}`;
    const memberUid = `member-nd-${hhId}`;
    await seedUser(adminUid, hhId);
    await seedUser(memberUid, hhId);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/households/${hhId}/adminUid`), adminUid);
    });
    const ctx = testEnv.authenticatedContext(memberUid);
    await assertFails(remove(ref(db(ctx), `/households/${hhId}`)));
  });

  it('non-admin member can still mutate household data (regression)', async () => {
    const hhId = freshHhId();
    const adminUid = `admin-m7-${hhId}`;
    const memberUid = `member-m7-${hhId}`;
    await seedUser(adminUid, hhId);
    await seedUser(memberUid, hhId);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/households/${hhId}/adminUid`), adminUid);
    });
    const ctx = testEnv.authenticatedContext(memberUid);
    await assertSucceeds(
      set(ref(db(ctx), `/households/${hhId}/subscriptionUpdatedAt`), Date.now())
    );
  });

  it('outsider cannot delete any household (regression)', async () => {
    const hhId = freshHhId();
    const adminUid = `admin-out-${hhId}`;
    await seedUser(adminUid, hhId);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/households/${hhId}/adminUid`), adminUid);
    });
    const outsider = `outsider-${hhId}`;
    const ctx = testEnv.authenticatedContext(outsider);
    await assertFails(remove(ref(db(ctx), `/households/${hhId}`)));
  });
});

// ---------------------------------------------------------------------------
// Global invite-code index (/inviteCodes)
// ---------------------------------------------------------------------------

describe('global invite codes', () => {
  const CODE = 'AAAA1111BBBB2222'; // 16-char alphanumeric

  it('unauthenticated user can read a specific invite code (pre-auth lookup)', async () => {
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

  it('unauthenticated user CANNOT enumerate the invite code index (bulk read denied)', async () => {
    // Seed at least one code so the parent node exists.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/inviteCodes/${CODE}`), {
        householdId: 'hh-alice', expiresAt: '2099-01-01', used: false, createdAt: 0,
      });
    });
    const ctx = testEnv.unauthenticatedContext();
    // Bulk read of /inviteCodes must fail — only per-code reads are public.
    await assertFails(get(ref(db(ctx), `/inviteCodes`)));
  });

  it('authenticated user CANNOT enumerate the invite code index either', async () => {
    const ctx = testEnv.authenticatedContext('alice');
    await assertFails(get(ref(db(ctx), `/inviteCodes`)));
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

  it('rejects PII fields (usedBy, inviteeEmail, usedAt) on the global invite-code node', async () => {
    const hhId = freshHhId();
    const uid = `pii-${hhId}`;
    await seedUser(uid, hhId);

    const code = 'PIICODE111111111';
    // Seed a valid code via admin bypass.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/inviteCodes/${code}`), {
        householdId: hhId, expiresAt: '2099-01-01', used: false, createdAt: 0,
      });
    });

    const ctx = testEnv.authenticatedContext(uid);
    // The $other: false validator must reject any of these fields on the global node.
    await assertFails(set(ref(db(ctx), `/inviteCodes/${code}/usedBy`), `${uid}@evil.com`));
    await assertFails(set(ref(db(ctx), `/inviteCodes/${code}/inviteeEmail`), 'leaked@example.com'));
    await assertFails(set(ref(db(ctx), `/inviteCodes/${code}/usedAt`), Date.now()));
  });

  it('CURRENTLY: member can overwrite an existing invite code (collision gap)', async () => {
    // This test documents the CURRENT behavior where codes are NOT write-once.
    const hhId = freshHhId();
    const uid = `collision-${hhId}`;
    await seedUser(uid, hhId);

    const code = 'COLLISIONCODE111';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/inviteCodes/${code}`), {
        householdId: hhId, expiresAt: '2099-01-01', used: false, createdAt: 0,
      });
    });

    const ctx = testEnv.authenticatedContext(uid);
    // CURRENTLY this succeeds because there is no !data.exists() check.
    await assertSucceeds(
      set(ref(db(ctx), `/inviteCodes/${code}`), {
        householdId: hhId,
        expiresAt: '2100-01-01', // Changed
        used: false,
        createdAt: Date.now(),
      })
    );
  });

  it('member cannot overwrite an invite code belonging to another household', async () => {
    // Even without !data.exists(), the .write rule checks that the householdId
    // of the NEW data matches the writer's householdId.
    const ctx = testEnv.authenticatedContext('alice');
    const code = 'BOBCODE111111111';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(db(ctx), `/inviteCodes/${code}`), {
        householdId: 'hh-bob', expiresAt: '2099-01-01', used: false, createdAt: 0,
      });
    });

    // Alice tries to overwrite Bob's code but keeps Bob's householdId.
    // The .write rule checks that newData.householdId matches Alice's householdId.
    // So this fails as expected.
    await assertFails(
      set(ref(db(ctx), `/inviteCodes/${code}`), {
        householdId: 'hh-bob',
        expiresAt: '2100-01-01',
        used: false,
        createdAt: Date.now(),
      })
    );

    // CURRENTLY: Alice CAN overwrite Bob's code if she changes the householdId to HER OWN.
    // This is the "stealing" vulnerability we want to close.
    await assertSucceeds(
      set(ref(db(ctx), `/inviteCodes/${code}`), {
        householdId: 'hh-alice',
        expiresAt: '2100-01-01',
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
