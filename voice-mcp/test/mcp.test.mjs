import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';

import worker from '../src/index.js';

const createEnv = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  return {
    FIREBASE_DATABASE_URL: 'https://example-default-rtdb.firebaseio.com',
    FIREBASE_PROJECT_ID: 'shopping-list-test',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'),
    OAUTH_CLIENT_ID: 'claude-test-client',
    OAUTH_CLIENT_SECRET: 'claude-test-secret',
    OAUTH_SIGNING_SECRET: 'oauth-signing-secret',
    OAUTH_ALLOWED_REDIRECT_URIS: 'https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback'
  };
};

const createFakeDatabase = () => ({
  'shopping-list': [
    { id: 1, name: 'bananas', category: 'FRUIT', quantity: '1', done: false }
  ],
  'shopping-history': ['bananas', 'ground pork'],
  'common-items': {
    FRUIT: [{ id: 'f1', name: 'apples' }, { id: 'f2', name: 'bananas' }],
    'MEAT ___HASH___INVALID': []
  },
  'less-common-items': {
    'MEAT & FISH': [{ id: 'm1', name: 'ground pork' }],
    'DELI, DAIRY, EGGS': [{ id: 'd1', name: 'milk, 2%' }]
  }
});

/** Same shape as createFakeDatabase but under `households/{id}/` (matches production RTDB layout). */
const nestFakeDatabaseUnderHousehold = (householdId, inner) => {
  const out = {};
  for (const [key, value] of Object.entries(inner)) {
    out[`households/${householdId}/${key}`] = value;
  }
  return out;
};

const createFetchStub = (databaseState) => {
  return async (url, init = {}) => {
    const target = typeof url === 'string' ? new URL(url) : new URL(url.url);

    if (target.origin === 'https://oauth2.googleapis.com') {
      return Response.json({ access_token: 'fake-token' });
    }

    if (target.origin === 'https://example-default-rtdb.firebaseio.com') {
      const path = target.pathname.replace(/^\//, '').replace(/\.json$/, '');
      if (init.method === 'PUT') {
        databaseState[path] = JSON.parse(init.body);
        return Response.json(databaseState[path]);
      }

      return Response.json(databaseState[path] ?? null);
    }

    throw new Error(`Unexpected fetch: ${target.toString()}`);
  };
};

const callMcp = async (body, env, fetchStub) => {
  const originalFetch = global.fetch;
  global.fetch = fetchStub;

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${env.__ACCESS_TOKEN__}`
        },
        body: JSON.stringify(body)
      }),
      env
    );

    return response.json();
  } finally {
    global.fetch = originalFetch;
  }
};

const createPkcePair = () => {
  const verifier = 'test-code-verifier-123456789';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

const authorizeAndGetAccessToken = async (env, fetchStub) => {
  const originalFetch = global.fetch;
  global.fetch = fetchStub;

  try {
    const { verifier, challenge } = createPkcePair();
    const authorizeUrl = new URL('https://worker.example/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', 'https://claude.ai/api/mcp/auth_callback');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('scope', 'mcp:tools');
    authorizeUrl.searchParams.set('resource', 'https://worker.example/mcp');
    authorizeUrl.searchParams.set('state', 'test-state');

    const authorizeResponse = await worker.fetch(
      new Request(authorizeUrl.toString(), { method: 'GET', redirect: 'manual' }),
      env
    );

    assert.equal(authorizeResponse.status, 302);
    const redirectLocation = authorizeResponse.headers.get('location');
    assert.ok(redirectLocation);
    const redirectUrl = new URL(redirectLocation);
    const code = redirectUrl.searchParams.get('code');
    assert.ok(code);

    const tokenResponse = await worker.fetch(
      new Request('https://worker.example/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: env.OAUTH_CLIENT_ID,
          client_secret: env.OAUTH_CLIENT_SECRET,
          code,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_verifier: verifier
        })
      }),
      env
    );

    const tokenPayload = await tokenResponse.json();
    assert.ok(tokenPayload.access_token);
    env.__ACCESS_TOKEN__ = tokenPayload.access_token;
  } finally {
    global.fetch = originalFetch;
  }
};

test('MCP endpoint initializes and lists shopping tools', async () => {
  const env = createEnv();
  const database = createFakeDatabase();
  const fetchStub = createFetchStub(database);
  await authorizeAndGetAccessToken(env, fetchStub);

  const initializeResponse = await callMcp(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    },
    env,
    fetchStub
  );

  assert.equal(initializeResponse.result.serverInfo.name, 'shopping-list-voice-mcp');
  assert.equal(initializeResponse.result.serverInfo.version, '0.2.2');

  const toolsResponse = await callMcp(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    },
    env,
    fetchStub
  );

  const toolNames = toolsResponse.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ['add_resolved_items', 'get_shopping_context', 'resolve_items']);
});

test('MCP resolve_items and add_resolved_items work against the worker', async () => {
  const env = createEnv();
  const database = createFakeDatabase();
  const fetchStub = createFetchStub(database);
  await authorizeAndGetAccessToken(env, fetchStub);

  const resolveResponse = await callMcp(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'resolve_items',
        arguments: {
          items: ['apples', 'bananas', 'masa harina']
        }
      }
    },
    env,
    fetchStub
  );

  const resolvePayload = resolveResponse.result.structuredContent;
  assert.equal(resolvePayload.resolved[0].name, 'apples');
  assert.deepEqual(resolvePayload.skipped, [{ spoken: 'bananas', reason: 'already_on_list' }]);
  assert.deepEqual(resolvePayload.unresolved, [{ spoken: 'masa harina', reason: 'no_confident_match' }]);

  const addResponse = await callMcp(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'add_resolved_items',
        arguments: {
          items: ['apples', 'masa harina'],
          categoryDecisions: [
            {
              spoken: 'masa harina',
              category: 'DRY GOODS',
              confidence: 0.88
            }
          ]
        }
      }
    },
    env,
    fetchStub
  );

  const addPayload = addResponse.result.structuredContent;
  assert.equal(addPayload.added.length, 2);
  assert.equal(addPayload.unresolved.length, 0);

  const names = database['shopping-list'].map((item) => item.name).sort();
  assert.deepEqual(names, ['apples', 'bananas', 'masa harina']);
});

test('MCP get_shopping_context uses households path when FIREBASE_HOUSEHOLD_ID is set', async () => {
  const env = { ...createEnv(), FIREBASE_HOUSEHOLD_ID: 'hh_demo_1' };
  const database = nestFakeDatabaseUnderHousehold('hh_demo_1', createFakeDatabase());
  const fetchStub = createFetchStub(database);
  await authorizeAndGetAccessToken(env, fetchStub);

  const ctxResponse = await callMcp(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'get_shopping_context',
        arguments: {}
      }
    },
    env,
    fetchStub
  );

  const payload = ctxResponse.result.structuredContent;
  assert.ok(payload.categorySummary);
  assert.deepEqual(payload.categorySummary.FRUIT.currentList, ['bananas']);
});
