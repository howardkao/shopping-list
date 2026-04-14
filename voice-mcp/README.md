# Shopping List Voice Worker

This folder contains the first-pass backend scaffold for Claude-powered voice add, including a real MCP tool surface over Streamable HTTP.

## What It Does Today

- loads live shopping context from Firebase Realtime Database
- resolves spoken item candidates against existing suggestion data
- skips items already on the list
- adds resolved items using the same list item shape the UI already expects
- supports Claude-assisted novel-item categorization by accepting category decisions on the add call
- exposes a real OAuth-protected MCP transport
- serves RFC 9728 protected-resource metadata and OAuth authorization-server metadata

## What It Does Not Do Yet

- deploy itself automatically

The business logic is exposed through MCP only. The old plain debug endpoints were removed from the public surface.

## Current Endpoints

- `GET /health`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /authorize`
- `POST /token`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
- `HEAD /mcp`

## MCP Tools

The `/mcp` endpoint exposes these tools:

- `get_shopping_context`
- `resolve_items`
- `add_resolved_items`

Recommended Claude flow:

1. Claude parses the user utterance into candidate items.
2. Claude calls `resolve_items`.
3. If unresolved items remain, Claude uses `categoryContext` to pick categories for only those items.
4. Claude calls `add_resolved_items`.
5. If low-confidence items remain unresolved, Claude asks a follow-up question.

## Claude Flow

This preserves the design rule that existing known items beat model judgment, while still letting Claude help on truly novel items.

## Environment Variables

Create `.dev.vars` from `.dev.vars.example`.

- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_HOUSEHOLD_ID` — **required in production**: Firebase Realtime Database path prefix `households/{id}/…` used by the web app. Use the same string as `users/{uid}/householdId` for your household (Firebase Console → Realtime Database, or any signed-in client user record). Without it, the worker reads/writes legacy root paths and the app will not see updates.
- `OAUTH_CLIENT_ID`
- `OAUTH_CLIENT_SECRET`
- `OAUTH_SIGNING_SECRET`
- `OAUTH_ALLOWED_REDIRECT_URIS`

The Firebase credentials should come from a service account with Realtime Database access.
OAuth config is mandatory in deployment. The worker now refuses non-health requests when it is unset.

## Local Testing

Run the deterministic resolver tests:

```bash
npm test
```

## Deploying To Cloudflare Workers

1. Install Wrangler if you do not already have it:

```bash
npm install -g wrangler
```

2. Log in to Cloudflare:

```bash
wrangler login
```

3. Set Worker secrets:

```bash
wrangler secret put FIREBASE_DATABASE_URL
wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put FIREBASE_CLIENT_EMAIL
wrangler secret put FIREBASE_PRIVATE_KEY
wrangler secret put FIREBASE_HOUSEHOLD_ID
wrangler secret put OAUTH_CLIENT_ID
wrangler secret put OAUTH_CLIENT_SECRET
wrangler secret put OAUTH_SIGNING_SECRET
```

4. If you want explicit redirect allowlisting beyond Claude defaults, set:

```bash
wrangler secret put OAUTH_ALLOWED_REDIRECT_URIS
```

5. Deploy:

```bash
wrangler deploy
```

Your MCP endpoint will then be:

```text
https://<your-worker>.workers.dev/mcp
```

## Connecting Claude

In Claude custom connectors, point the remote connector URL at:

```text
https://<your-worker>.workers.dev/mcp
```

Use the same values in Claude’s connector UI for:

- OAuth Client ID
- OAuth Client Secret

Claude’s official custom connector docs indicate remote MCP uses OAuth 2.0 authorization code flow, and Anthropic’s submission guide lists these callback URLs:

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`

Those are allowlisted by default in this worker unless you override `OAUTH_ALLOWED_REDIRECT_URIS`.

## Deployment Shape

Recommended host:

- Cloudflare Workers free tier

Recommended next step:

- deploy to Cloudflare Workers and connect Claude to the `/mcp` endpoint as a custom remote connector
