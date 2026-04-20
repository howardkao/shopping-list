import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { createMcpServer, MCP_SERVER_VERSION, MCP_TOOL_NAMES } from './mcpServer.js';

const json = (body, init = {}) => {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
};

const MAX_REQUEST_BYTES = 16 * 1024;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const AUTH_CODE_TTL_SECONDS = 60 * 5;
const DEFAULT_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback'
];

const encoder = new TextEncoder();

const toBase64Url = (input) => {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const constantTimeEqual = (left, right) => {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));

  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
};

const importHmacKey = async (secret) => {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
};

const signPayload = async (payload, secret) => {
  const serialized = JSON.stringify(payload);
  const encodedPayload = toBase64Url(serialized);
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
};

const verifySignedPayload = async (token, secret) => {
  const [encodedPayload, encodedSignature] = String(token || '').split('.');
  if (!encodedPayload || !encodedSignature) {
    throw new Error('invalid_token_format');
  }

  const key = await importHmacKey(secret);
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64Url(encodedSignature),
    encoder.encode(encodedPayload)
  );

  if (!isValid) {
    throw new Error('invalid_token_signature');
  }

  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token_expired');
  }

  return payload;
};

const sha256Base64Url = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
};

const splitScopes = (scope) => String(scope || '').split(/\s+/).filter(Boolean);

const getIssuerUrl = (request, env) => {
  if (env.OAUTH_ISSUER_URL) {
    return new URL(env.OAUTH_ISSUER_URL);
  }
  return new URL(request.url).origin.endsWith('/')
    ? new URL(new URL(request.url).origin)
    : new URL(`${new URL(request.url).origin}/`);
};

const getResourceServerUrl = (request) => new URL('/mcp', request.url);

const getProtectedResourceMetadataUrl = (request) => {
  const resourceUrl = getResourceServerUrl(request);
  return new URL(`/.well-known/oauth-protected-resource${resourceUrl.pathname}`, resourceUrl.origin).toString();
};

const getAllowedRedirectUris = (env) => {
  if (!env.OAUTH_ALLOWED_REDIRECT_URIS) {
    return DEFAULT_REDIRECT_URIS;
  }

  return env.OAUTH_ALLOWED_REDIRECT_URIS
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getOAuthMetadata = (request, env) => {
  const issuerUrl = getIssuerUrl(request, env);
  return {
    issuer: issuerUrl.href.replace(/\/$/, ''),
    authorization_endpoint: new URL('/authorize', issuerUrl).href,
    token_endpoint: new URL('/token', issuerUrl).href,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp:tools']
  };
};

const getProtectedResourceMetadata = (request, env) => {
  const metadata = getOAuthMetadata(request, env);
  return {
    resource: getResourceServerUrl(request).href,
    authorization_servers: [metadata.issuer],
    scopes_supported: ['mcp:tools'],
    bearer_methods_supported: ['header'],
    resource_name: 'Provisions Voice MCP'
  };
};

const buildWwwAuthenticateHeader = (request, errorCode, description) => {
  return `Bearer error="${errorCode}", error_description="${description}", resource_metadata="${getProtectedResourceMetadataUrl(request)}"`;
};

const requestTooLarge = (request) => {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) {
    return false;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > MAX_REQUEST_BYTES;
};

const requireConfig = (env) => {
  return Boolean(env.OAUTH_CLIENT_ID && env.OAUTH_CLIENT_SECRET && env.OAUTH_SIGNING_SECRET);
};

const parseJsonBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const parseFormBody = async (request) => {
  try {
    return await request.formData();
  } catch {
    return null;
  }
};

const unauthorized = (request, errorCode = 'invalid_token', description = 'Missing or invalid bearer token') => {
  return json(
    {
      error: errorCode,
      error_description: description
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': buildWwwAuthenticateHeader(request, errorCode, description)
      }
    }
  );
};

const badRequest = (error, description) => json(
  {
    error,
    error_description: description
  },
  { status: 400 }
);

const extractClientCredentials = (request, formData) => {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const decoded = new TextDecoder().decode(fromBase64Url(authHeader.slice(6).replace(/\+/g, '-').replace(/\//g, '_')));
    const separator = decoded.indexOf(':');
    if (separator > -1) {
      return {
        clientId: decoded.slice(0, separator),
        clientSecret: decoded.slice(separator + 1)
      };
    }
  }

  return {
    clientId: formData.get('client_id')?.toString(),
    clientSecret: formData.get('client_secret')?.toString()
  };
};

const verifyClient = (clientId, clientSecret, env) => {
  return constantTimeEqual(clientId, env.OAUTH_CLIENT_ID) && constantTimeEqual(clientSecret, env.OAUTH_CLIENT_SECRET);
};

const createAuthorizationCode = async (params, request, env) => {
  return signPayload(
    {
      typ: 'auth_code',
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      scope: params.scope,
      resource: params.resource,
      code_challenge: params.codeChallenge,
      exp: Math.floor(Date.now() / 1000) + AUTH_CODE_TTL_SECONDS,
      aud: getResourceServerUrl(request).href
    },
    env.OAUTH_SIGNING_SECRET
  );
};

const createAccessToken = async (params, request, env) => {
  return signPayload(
    {
      typ: 'access_token',
      client_id: params.clientId,
      scope: params.scope,
      resource: params.resource || getResourceServerUrl(request).href,
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
      aud: getResourceServerUrl(request).href
    },
    env.OAUTH_SIGNING_SECRET
  );
};

const createRefreshToken = async (params, request, env) => {
  return signPayload(
    {
      typ: 'refresh_token',
      client_id: params.clientId,
      scope: params.scope,
      resource: params.resource || getResourceServerUrl(request).href,
      exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_SECONDS,
      aud: getResourceServerUrl(request).href
    },
    env.OAUTH_SIGNING_SECRET
  );
};

const verifyBearerToken = async (request, env) => {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('missing_bearer_token');
  }

  const token = authHeader.slice(7);
  const payload = await verifySignedPayload(token, env.OAUTH_SIGNING_SECRET);
  if (payload.typ !== 'access_token') {
    throw new Error('invalid_token_type');
  }

  if (payload.aud !== getResourceServerUrl(request).href) {
    throw new Error('invalid_token_audience');
  }

  return {
    token,
    clientId: payload.client_id,
    scopes: splitScopes(payload.scope),
    expiresAt: payload.exp,
    resource: payload.resource
  };
};

const handleAuthorize = async (request, env) => {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const clientId = url.searchParams.get('client_id');
  const state = url.searchParams.get('state');
  const scope = url.searchParams.get('scope') || 'mcp:tools';
  const resource = url.searchParams.get('resource') || getResourceServerUrl(request).href;
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');

  if (request.method !== 'GET') {
    return badRequest('invalid_request', 'Authorization endpoint only supports GET');
  }

  if (responseType !== 'code') {
    return badRequest('unsupported_response_type', 'Only authorization code flow is supported');
  }

  if (!clientId || clientId !== env.OAUTH_CLIENT_ID) {
    return badRequest('unauthorized_client', 'Unknown client_id');
  }

  if (!redirectUri || !getAllowedRedirectUris(env).includes(redirectUri)) {
    return badRequest('invalid_request', 'Unapproved redirect_uri');
  }

  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return badRequest('invalid_request', 'PKCE with S256 is required');
  }

  const authorizationCode = await createAuthorizationCode(
    {
      clientId,
      redirectUri,
      scope,
      resource,
      codeChallenge
    },
    request,
    env
  );

  const target = new URL(redirectUri);
  target.searchParams.set('code', authorizationCode);
  if (state) {
    target.searchParams.set('state', state);
  }

  return Response.redirect(target.toString(), 302);
};

const handleToken = async (request, env) => {
  if (request.method !== 'POST') {
    return badRequest('invalid_request', 'Token endpoint only supports POST');
  }

  const formData = await parseFormBody(request);
  if (!formData) {
    return badRequest('invalid_request', 'Expected form-encoded body');
  }

  const { clientId, clientSecret } = extractClientCredentials(request, formData);
  if (!verifyClient(clientId, clientSecret, env)) {
    return json(
      {
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      },
      { status: 401 }
    );
  }

  const grantType = formData.get('grant_type')?.toString();

  if (grantType === 'authorization_code') {
    const code = formData.get('code')?.toString();
    const redirectUri = formData.get('redirect_uri')?.toString();
    const codeVerifier = formData.get('code_verifier')?.toString();

    if (!code || !redirectUri || !codeVerifier) {
      return badRequest('invalid_request', 'Missing code, redirect_uri, or code_verifier');
    }

    try {
      const payload = await verifySignedPayload(code, env.OAUTH_SIGNING_SECRET);
      if (payload.typ !== 'auth_code') {
        return badRequest('invalid_grant', 'Authorization code is invalid');
      }
      if (!constantTimeEqual(payload.client_id, clientId) || !constantTimeEqual(payload.redirect_uri, redirectUri)) {
        return badRequest('invalid_grant', 'Authorization code does not match client or redirect_uri');
      }

      const verifierHash = await sha256Base64Url(codeVerifier);
      if (!constantTimeEqual(verifierHash, payload.code_challenge)) {
        return badRequest('invalid_grant', 'PKCE verification failed');
      }

      const access_token = await createAccessToken(
        {
          clientId,
          scope: payload.scope,
          resource: payload.resource
        },
        request,
        env
      );
      const refresh_token = await createRefreshToken(
        {
          clientId,
          scope: payload.scope,
          resource: payload.resource
        },
        request,
        env
      );

      return json({
        access_token,
        token_type: 'bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token,
        scope: payload.scope
      });
    } catch {
      return badRequest('invalid_grant', 'Authorization code is invalid or expired');
    }
  }

  if (grantType === 'refresh_token') {
    const refreshToken = formData.get('refresh_token')?.toString();
    if (!refreshToken) {
      return badRequest('invalid_request', 'Missing refresh_token');
    }

    try {
      const payload = await verifySignedPayload(refreshToken, env.OAUTH_SIGNING_SECRET);
      if (payload.typ !== 'refresh_token' || !constantTimeEqual(payload.client_id, clientId)) {
        return badRequest('invalid_grant', 'Refresh token is invalid');
      }

      const access_token = await createAccessToken(
        {
          clientId,
          scope: payload.scope,
          resource: payload.resource
        },
        request,
        env
      );

      return json({
        access_token,
        token_type: 'bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: payload.scope
      });
    } catch {
      return badRequest('invalid_grant', 'Refresh token is invalid or expired');
    }
  }

  return badRequest('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token');
};

const handleMcpRequest = async (request, env, authInfo) => {
  const server = createMcpServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { authInfo });
  } finally {
    await server.close().catch(() => {});
    await transport.close().catch(() => {});
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        oauthConfigured: requireConfig(env),
        mcpServerVersion: MCP_SERVER_VERSION,
        mcpTools: MCP_TOOL_NAMES
      });
    }

    if (!requireConfig(env)) {
      return json({ error: 'server_misconfigured' }, { status: 503 });
    }

    if (requestTooLarge(request)) {
      return json({ error: 'request_too_large' }, { status: 413 });
    }

    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      return json(getOAuthMetadata(request, env));
    }

    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json(getProtectedResourceMetadata(request, env));
    }

    if (url.pathname === '/authorize') {
      return handleAuthorize(request, env);
    }

    if (url.pathname === '/token') {
      return handleToken(request, env);
    }

    if (url.pathname === '/mcp') {
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200 });
      }

      if (!['POST', 'GET', 'DELETE'].includes(request.method)) {
        return json({ error: 'method_not_allowed' }, { status: 405 });
      }

      try {
        const authInfo = await verifyBearerToken(request, env);
        return await handleMcpRequest(request, env, authInfo);
      } catch {
        return unauthorized(request);
      }
    }

    return json(
      {
        error: 'not_found',
        message: 'Available endpoints: GET /health, GET /.well-known/oauth-authorization-server, GET /.well-known/oauth-protected-resource/mcp, GET /authorize, POST /token, POST|GET|DELETE|HEAD /mcp'
      },
      { status: 404 }
    );
  }
};
