import { rtdbGet, rtdbPatch } from './firebaseRealtime.js';
import { inviteEmailHtml, inviteEmailText } from './emailTemplates.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

const ok = (extra = {}) => json({ ok: true, ...extra });
const err = (message, status = 400) => json({ ok: false, error: message }, status);

const cors = () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

const handleSendInvite = async (request, env) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return err('Invalid JSON body');
  }

  const { code, inviteeEmail, householdId } = body || {};
  if (!code || !inviteeEmail || !householdId) {
    return err('Missing required fields: code, inviteeEmail, householdId');
  }

  // Validate the invite code against the global RTDB lookup index.
  let codeData;
  try {
    codeData = await rtdbGet(env, `inviteCodes/${code}`);
  } catch (e) {
    return err(`Failed to read invite code: ${e.message}`, 500);
  }

  if (!codeData) return err('Invalid invite code');
  if (codeData.householdId !== householdId) return err('Code does not belong to this household');
  if (codeData.used) return err('Invite code has already been used');
  if (Date.now() > new Date(codeData.expiresAt).getTime()) return err('Invite code has expired');

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
    return err(`Email send failed: ${detail}`, 502);
  }

  // Record the invitee email on both RTDB paths.
  try {
    await Promise.all([
      rtdbPatch(env, `inviteCodes/${code}`, { inviteeEmail }),
      rtdbPatch(env, `households/${householdId}/inviteCodes/${code}`, { inviteeEmail }),
    ]);
  } catch {
    // Non-fatal: email was sent; just couldn't write metadata.
  }

  return ok();
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors();

    const { pathname } = new URL(request.url);

    if (pathname === '/health' && request.method === 'GET') {
      return ok({ service: 'provisions-invite-worker' });
    }

    if (pathname === '/send-invite' && request.method === 'POST') {
      return handleSendInvite(request, env);
    }

    return err('Not found', 404);
  },
};
