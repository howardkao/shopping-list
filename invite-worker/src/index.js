import { rtdbGet, rtdbPatch } from './firebaseRealtime.js';
import { inviteEmailHtml, inviteEmailText } from './emailTemplates.js';
import { verifyFirebaseIdToken } from './firebaseAuth.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
const INVITE_CODE_RE = /^[A-Z0-9]{16}$/;
const MAX_DISPLAY_NAME_LEN = 100;

const ALLOWED_ORIGINS = new Set([
  'https://myprovisions.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'capacitor://localhost',
]);

// Returns the request's Origin if it's in the allowlist, otherwise falls back
// to the production origin so browsers block cross-origin requests from unknown hosts.
const resolveOrigin = (request) => {
  const o = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.has(o) ? o : 'https://myprovisions.app';
};

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Vary': 'Origin',
});

const json = (body, status = 200, origin = 'https://myprovisions.app') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });

const ok = (extra = {}, origin) => json({ ok: true, ...extra }, 200, origin);
const err = (message, status = 400, origin) => json({ ok: false, error: message }, status, origin);

const cors = (origin) =>
  new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

// Rate-limit check. Requires RATE_LIMITER binding in wrangler.toml (see commented block).
// Returns false when the limit is exceeded; returns true when not configured (graceful degradation).
const checkRateLimit = async (env, key) => {
  if (!env.RATE_LIMITER) return true;
  const { success } = await env.RATE_LIMITER.limit({ key });
  return success;
};

const handleSendInvite = async (request, env, origin) => {
  if (!env.FIREBASE_PROJECT_ID) {
    return err('server_misconfigured: FIREBASE_PROJECT_ID not set', 503, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `send:${ip}`)) {
    return err('Too many requests', 429, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body', 400, origin);
  }

  const { idToken, code, inviteeEmail, householdId } = body || {};
  if (!idToken || !code || !inviteeEmail || !householdId) {
    return err('Missing required fields: idToken, code, inviteeEmail, householdId', 400, origin);
  }

  // Verify the caller's Firebase ID token.
  let verified;
  try {
    verified = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return err(`invalid_id_token: ${e.message}`, 401, origin);
  }

  // Verify the caller is an active member of the specified household.
  let memberRecord;
  try {
    memberRecord = await rtdbGet(env, `households/${householdId}/members/${verified.uid}`);
  } catch (e) {
    return err(`Failed to verify household membership: ${e.message}`, 500, origin);
  }
  if (!memberRecord) {
    return err('Not a member of this household', 403, origin);
  }

  // Validate the invite code against the global RTDB lookup index.
  let codeData;
  try {
    codeData = await rtdbGet(env, `inviteCodes/${code}`);
  } catch (e) {
    return err(`Failed to read invite code: ${e.message}`, 500, origin);
  }

  if (!codeData) return err('Invalid invite code', 400, origin);
  if (codeData.householdId !== householdId) return err('Code does not belong to this household', 400, origin);
  if (codeData.used) return err('Invite code has already been used', 400, origin);
  if (Date.now() > new Date(codeData.expiresAt).getTime()) return err('Invite code has expired', 400, origin);

  const joinUrl = `${(env.APP_BASE_URL || 'https://myprovisions.app').replace(/\/$/, '')}?code=${code}`;

  // Send via Resend.
  const resendRes = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `Provisions <${env.INVITE_FROM_EMAIL || 'invite@myprovisions.app'}>`,
      to: [inviteeEmail],
      subject: "You've been invited to join a household on Provisions",
      html: inviteEmailHtml({ joinUrl, expiresAt: codeData.expiresAt }),
      text: inviteEmailText({ joinUrl, expiresAt: codeData.expiresAt }),
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text();
    return err(`Email send failed: ${detail}`, 502, origin);
  }

  // Record the invitee email only on the household-scoped copy. The global
  // `/inviteCodes/{code}` node is publicly readable (per-code) for pre-auth
  // code lookup; writing the email there would leak PII to anyone who knows
  // (or guesses) a code.
  try {
    await rtdbPatch(env, `households/${householdId}/inviteCodes/${code}`, { inviteeEmail });
  } catch {
    // Non-fatal: email was sent; just couldn't write metadata.
  }

  return ok({}, origin);
};

/**
 * Server-mediated invite redemption. The client sends its just-minted Firebase ID token
 * plus the invite code; the worker (with admin SDK privileges) verifies the token, atomically
 * creates the user/member records, and marks the code used.
 *
 * Doing this server-side lets RTDB security rules require that `users/<uid>/householdId`
 * point to a household where the writer is already a member — which closes the IDOR where
 * any authenticated user could self-claim any household ID and gain access to it.
 */
const handleRedeemInvite = async (request, env, origin) => {
  if (!env.FIREBASE_PROJECT_ID) {
    return err('server_misconfigured: FIREBASE_PROJECT_ID not set', 503, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `redeem:${ip}`)) {
    return err('Too many requests', 429, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body', 400, origin);
  }

  const { idToken, code: rawCode, displayName: rawDisplayName } = body || {};
  if (!idToken || !rawCode || !rawDisplayName) {
    return err('Missing required fields: idToken, code, displayName', 400, origin);
  }

  const code = String(rawCode).trim().toUpperCase();
  if (!INVITE_CODE_RE.test(code)) {
    return err('Invalid invite code format', 400, origin);
  }

  const displayName = String(rawDisplayName).trim().slice(0, MAX_DISPLAY_NAME_LEN);
  if (!displayName) {
    return err('Display name cannot be empty', 400, origin);
  }

  // Verify the Firebase ID token. Failure means we don't trust the caller's identity claim.
  let verified;
  try {
    verified = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return err(`invalid_id_token: ${e.message}`, 401, origin);
  }

  const uid = verified.uid;
  const email = verified.email;
  if (!email) {
    return err('Token missing email claim', 401, origin);
  }

  // Reject if the caller is already set up in a household. This blocks accidentally
  // double-redeeming or a malicious user trying to switch households via this endpoint.
  let existingUser;
  try {
    existingUser = await rtdbGet(env, `users/${uid}`);
  } catch (e) {
    return err(`Failed to read existing user: ${e.message}`, 500, origin);
  }
  if (existingUser && existingUser.householdId) {
    return err('User is already a member of a household', 409, origin);
  }

  // Validate the invite code via the global RTDB lookup.
  let codeData;
  try {
    codeData = await rtdbGet(env, `inviteCodes/${code}`);
  } catch (e) {
    return err(`Failed to read invite code: ${e.message}`, 500, origin);
  }
  if (!codeData) return err('Invalid invite code', 404, origin);
  if (codeData.used) return err('Invite code has already been used', 409, origin);
  if (Date.now() > new Date(codeData.expiresAt).getTime()) return err('Invite code has expired', 410, origin);
  const householdId = codeData.householdId;
  if (!householdId) return err('Invite code is missing a householdId', 500, origin);

  const now = Date.now();

  // Atomic multi-path update via the database root. Doing this in one PATCH means either
  // every write commits or none — so the user can never end up half-joined.
  // members/<uid> written as one object so the rules' `newData.child('members').hasChild(...)`
  // check sees it; admin SDK bypasses rules, but keeping the shape consistent with the
  // client-side bootstrap simplifies future rule auditing.
  const updates = {
    [`users/${uid}/email`]: email,
    [`users/${uid}/displayName`]: displayName,
    [`users/${uid}/householdId`]: householdId,
    [`users/${uid}/createdAt`]: now,
    [`households/${householdId}/members/${uid}`]: { displayName, email },
    [`inviteCodes/${code}/used`]: true,
    [`households/${householdId}/inviteCodes/${code}/used`]: true,
    [`households/${householdId}/inviteCodes/${code}/usedBy`]: email,
    [`households/${householdId}/inviteCodes/${code}/usedAt`]: now,
  };

  try {
    await rtdbPatch(env, '', updates);
  } catch (e) {
    return err(`Failed to redeem invite: ${e.message}`, 500, origin);
  }

  return ok({ householdId }, origin);
};

export default {
  async fetch(request, env) {
    const origin = resolveOrigin(request);

    if (request.method === 'OPTIONS') return cors(origin);

    const { pathname } = new URL(request.url);

    if (pathname === '/health' && request.method === 'GET') {
      return ok({ service: 'provisions-invite-worker' }, origin);
    }

    if (pathname === '/send-invite' && request.method === 'POST') {
      return handleSendInvite(request, env, origin);
    }

    if (pathname === '/redeem-invite' && request.method === 'POST') {
      return handleRedeemInvite(request, env, origin);
    }

    return err('Not found', 404, origin);
  },
};
