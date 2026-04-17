import { decodeCategory, encodeCategory } from './categoryEncoding.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Realtime Database path prefix for household-scoped data (matches web app).
 * When unset, paths stay at DB root (legacy / tests only).
 */
const rtdbPrefix = (env) => {
  const id = (env.FIREBASE_HOUSEHOLD_ID || '').trim();
  if (!id) return '';
  if (!/^[-A-Za-z0-9_]+$/.test(id) || id.length > 50) {
    throw new Error('FIREBASE_HOUSEHOLD_ID must be 1–50 characters: letters, digits, hyphen, underscore');
  }
  return `households/${id}`;
};

const rtdbPath = (env, key) => {
  const prefix = rtdbPrefix(env);
  return prefix ? `${prefix}/${key}` : key;
};

const toBase64Url = (input) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const importPrivateKey = async (privateKeyPem) => {
  const clean = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binary = Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
};

const signJwt = async (claims, privateKeyPem) => {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaims = toBase64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
};

const getAccessToken = async (env) => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  }, env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'));

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Google access token: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return payload.access_token;
};

const firebaseRequest = async (env, path, init = {}) => {
  const accessToken = await getAccessToken(env);
  const url = new URL(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}.json`);
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firebase request failed for ${path}: ${response.status} ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const decodeCategoryMap = (record = {}) => {
  const decoded = {};
  for (const [encodedCategory, items] of Object.entries(record || {})) {
    decoded[decodeCategory(encodedCategory)] = items || [];
  }
  return decoded;
};

export const loadShoppingContext = async (env) => {
  const [currentList, commonItems, lessCommonItems, history] = await Promise.all([
    firebaseRequest(env, rtdbPath(env, 'shopping-list')),
    firebaseRequest(env, rtdbPath(env, 'common-items')),
    firebaseRequest(env, rtdbPath(env, 'less-common-items')),
    firebaseRequest(env, rtdbPath(env, 'shopping-history'))
  ]);

  return {
    currentList: currentList || [],
    commonItems: decodeCategoryMap(commonItems),
    lessCommonItems: decodeCategoryMap(lessCommonItems),
    history: history || []
  };
};

/** Local calendar month (YYYY-MM); must match web app `itemEventsSharding.eventMonthKey`. */
const eventMonthKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const logItemEvents = async (env, items, addedByUid) => {
  if (!items?.length) return;
  const ts = Date.now();
  const month = eventMonthKey(ts);
  const monthPath = rtdbPath(env, `item-events-by-month/${month}`);
  const indexPath = rtdbPath(env, `item-events-index/${month}`);
  await Promise.all(items.map((item) => {
    const qtyStr = item?.quantity != null ? String(item.quantity).trim().slice(0, 100) : '';
    const event = {
      ts,
      uid: addedByUid || 'voice-mcp',
      name: (item?.name || '').toLowerCase().slice(0, 200),
      category: (item?.category || '').slice(0, 100),
      action: 'added',
      source: 'voice',
      qty: Number(item?.quantity) || 1,
      ...(qtyStr ? { quantityLabel: qtyStr } : {})
    };
    return firebaseRequest(env, monthPath, {
      method: 'POST',
      body: JSON.stringify(event)
    }).catch(() => { /* fire-and-forget; never block list writes */ });
  }));
  await firebaseRequest(env, indexPath, {
    method: 'PATCH',
    body: JSON.stringify({ updatedAt: ts })
  }).catch(() => { /* index is best-effort */ });
};

export const appendItemsToShoppingList = async (env, items, addedByUid) => {
  const currentList = (await firebaseRequest(env, rtdbPath(env, 'shopping-list'))) || [];
  const nextList = [...currentList, ...items];
  await firebaseRequest(env, rtdbPath(env, 'shopping-list'), {
    method: 'PUT',
    body: JSON.stringify(nextList)
  });
  await logItemEvents(env, items, addedByUid);
  return nextList;
};

export const saveShoppingHistory = async (env, history) => {
  await firebaseRequest(env, rtdbPath(env, 'shopping-history'), {
    method: 'PUT',
    body: JSON.stringify(history)
  });
};

export const saveSuggestionMap = async (env, path, itemsByCategory) => {
  const encoded = {};
  for (const [category, items] of Object.entries(itemsByCategory)) {
    encoded[encodeCategory(category)] = items;
  }

  await firebaseRequest(env, rtdbPath(env, path), {
    method: 'PUT',
    body: JSON.stringify(encoded)
  });
};
