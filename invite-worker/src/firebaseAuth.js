// Firebase ID-token verification for Cloudflare Workers (no firebase-admin SDK).
// Fetches Google's JWK set, verifies the RS256 signature with WebCrypto, and validates claims.
//
// Reference: https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const MIN_JWKS_TTL_MS = 60_000;
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;

let cachedJwks = null;
let cachedJwksExpireAt = 0;

const decodeBase64Url = (input) => {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(normalized + padding);
};

const decodeBase64UrlToUint8 = (input) => {
  const binary = decodeBase64Url(input);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const fetchJwks = async () => {
  const res = await fetch(FIREBASE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`firebase_jwks_fetch_failed: ${res.status}`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch
    ? Math.max(MIN_JWKS_TTL_MS, Number(maxAgeMatch[1]) * 1000)
    : DEFAULT_JWKS_TTL_MS;

  const body = await res.json();
  const byKid = {};
  for (const key of body.keys || []) {
    if (key.kid) byKid[key.kid] = key;
  }
  return { byKid, expireAt: Date.now() + ttlMs };
};

const getJwks = async () => {
  const now = Date.now();
  if (cachedJwks && now < cachedJwksExpireAt) return cachedJwks;
  const fresh = await fetchJwks();
  cachedJwks = fresh.byKid;
  cachedJwksExpireAt = fresh.expireAt;
  return cachedJwks;
};

/**
 * Verify a Firebase ID token. Returns `{ uid, email, emailVerified, authTime, claims }`.
 * Throws on any verification failure (signature, claims, expiry).
 */
export const verifyFirebaseIdToken = async (idToken, projectId) => {
  if (!projectId) throw new Error('missing_project_id');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed_token');

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64Url(headerB64));
    payload = JSON.parse(decodeBase64Url(payloadB64));
  } catch {
    throw new Error('malformed_token');
  }

  if (header.alg !== 'RS256') throw new Error('unsupported_alg');
  if (!header.kid) throw new Error('missing_kid');

  const jwks = await getJwks();
  const jwk = jwks[header.kid];
  if (!jwk) {
    // Force a refresh in case the keys rotated mid-cache.
    cachedJwks = null;
    cachedJwksExpireAt = 0;
    const fresh = await getJwks();
    if (!fresh[header.kid]) throw new Error('unknown_kid');
  }

  const usedJwk = (cachedJwks || {})[header.kid] || jwk;
  const key = await crypto.subtle.importKey(
    'jwk',
    usedJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = decodeBase64UrlToUint8(signatureB64);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!ok) throw new Error('invalid_signature');

  const now = Math.floor(Date.now() / 1000);
  const skewSec = 60;

  if (payload.aud !== projectId) throw new Error('wrong_audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('wrong_issuer');
  if (typeof payload.exp !== 'number' || payload.exp < now - skewSec) throw new Error('token_expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + skewSec) throw new Error('token_issued_in_future');
  if (typeof payload.auth_time !== 'number' || payload.auth_time > now + skewSec) throw new Error('auth_time_in_future');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('missing_subject');

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true,
    authTime: payload.auth_time,
    claims: payload,
  };
};
