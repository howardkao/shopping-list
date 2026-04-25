const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const toBase64Url = (input) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const importPrivateKey = async (pem) => {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', binary.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
};

const signJwt = async (claims, privateKeyPem) => {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
};

const getAccessToken = async (env) => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }, env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'));

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`Google token fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
};

const rtdbRequest = async (env, path, init = {}) => {
  const token = await getAccessToken(env);
  const url = new URL(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}.json`);
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString(), { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Firebase ${path} failed: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
};

export const rtdbGet = (env, path) => rtdbRequest(env, path);

export const rtdbPatch = (env, path, data) =>
  rtdbRequest(env, path, { method: 'PATCH', body: JSON.stringify(data) });
