# Blackthorn Chat

A simple chat interface for [Arcium Blackthorn](https://www.arcium.com/blackthorn)
encrypted inference. Next.js (App Router), streaming replies, markdown rendering
and an optional shared-password gate.

## How it reaches Blackthorn

Blackthorn has no plain hosted HTTP API: the `blackthorn` client seals each
request on the machine it runs on and exposes an OpenAI-compatible API locally.
This app's server route forwards chat requests to that client:

```
browser ──HTTPS──> this app (/api/chat) ──> blackthorn serve ══sealed══> GPU
```

Prompts are plaintext up to the Blackthorn client and encrypted from there on.
Whoever runs this app and the client can therefore see them; the GPU host cannot.

## Run locally

```bash
blackthorn login     # once, paste your API key
blackthorn serve     # OpenAI-compatible API on 127.0.0.1:8000
```

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Configuration

| Variable              | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `BLACKTHORN_BASE_URL` | URL of the Blackthorn client. Default `http://127.0.0.1:8000/v1`.       |
| `BLACKTHORN_API_KEY`  | Optional bearer token, if the client sits behind an authenticating proxy. |
| `BLACKTHORN_MODEL`    | Optional model id. Defaults to the first model the client lists.        |
| `APP_PASSWORD`        | Shared access password. Required in production; empty locally = no gate. |
| `SYSTEM_PROMPT`       | Optional system prompt.                                                 |

In production the app refuses all chat requests until `APP_PASSWORD` is set.

## Project layout

```
app/
  page.tsx            entry page
  api/chat/route.ts   streams chat completions from the Blackthorn client
  api/login/route.ts  password check, sets the session cookie
  api/session/route.ts  sign-in state and model name
components/           App, Login, Chat (client components)
lib/auth.ts           password gate
lib/blackthorn.ts     endpoint and model resolution
```

## Deploying

A hosted deployment needs `BLACKTHORN_BASE_URL` to point at a Blackthorn client
it can reach over the network (`127.0.0.1` only works on your own machine), plus
`APP_PASSWORD`.
