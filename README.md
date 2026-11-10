# Blackthorn Chat

A simple chat interface for [Arcium Blackthorn](https://www.arcium.com/blackthorn)
encrypted inference. Next.js (App Router), streaming replies, markdown rendering,
a chat list saved in the browser, a model selector and an optional
shared-password gate.

Chat history is stored in the browser's localStorage only (unencrypted, per
device); deleting a chat in the left panel removes it from there.

## How it reaches Blackthorn

Blackthorn has no plain hosted HTTP API: the `blackthorn` client seals each
request on the machine it runs on and exposes an OpenAI-compatible API locally.
This app's server route forwards chat requests to that client:

```
browser ──HTTPS──> this app (/api/chat) ──> blackthorn serve ══sealed══> GPU
```

Prompts are plaintext up to the Blackthorn client and encrypted from there on.
Whoever runs this app and the client can therefore see them; the GPU host cannot.

## Web search

The model can search the web through a `web_search` tool when a search key is
configured and the user leaves the "Web search" toggle on:

- `TAVILY_API_KEY` – Tavily, free plan without a credit card.
- `BRAVE_API_KEY` – Brave Search (metered, credit card required). Used instead
  of Tavily when set.

Search queries are sent to that provider in plaintext, outside Blackthorn's
encryption. The model writes the query, the server runs it (`lib/search.ts`),
and the reply lists the sources. With no key set, the toggle is hidden.

## What the assistant knows about itself

`lib/system-prompt.ts` gives the model an accurate description of this app's
data path, Blackthorn and Arcium, so questions like "is this running
privately?" get a factual answer. Update it when the architecture changes.

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
| `BLACKTHORN_BASE_URL` | URL of your own Blackthorn client. Default `http://127.0.0.1:8000/v1`.  |
| `BLACKTHORN_TOKEN`    | Blackthorn API key for the bundled client (hosted deployments).        |
| `BLACKTHORN_HOST`     | Optional Blackthorn host for the bundled client.                        |
| `BLACKTHORN_API_KEY`  | Optional bearer token, if the client sits behind an authenticating proxy. |
| `BLACKTHORN_MODEL`    | Optional model id. Defaults to the first model the client lists.        |
| `TAVILY_API_KEY`      | Optional web search key (Tavily).                                       |
| `BRAVE_API_KEY`       | Optional web search key (Brave Search); takes precedence over Tavily.   |
| `APP_PASSWORD`        | Shared access password. Required in production; empty locally = no gate. |
| `SYSTEM_PROMPT`       | Optional extra instructions appended to the built-in system prompt.     |

In production the app refuses all chat requests until `APP_PASSWORD` is set.

## Project layout

```
app/
  page.tsx            entry page
  api/chat/route.ts   streams chat completions from the Blackthorn client
  api/login/route.ts  password check, sets the session cookie
  api/session/route.ts  sign-in state and model name
components/           App, Login, Chat, Sidebar, ThinkingIndicator
lib/auth.ts           password gate
lib/blackthorn.ts     endpoint and model list
lib/client-process.ts runs the bundled client on hosted deployments
lib/chats.ts          chat history in the browser's localStorage
lib/stream.ts         stream parsing and steady text reveal
lib/search.ts         web search providers and the search tool
lib/system-prompt.ts  what the assistant knows about this app, Blackthorn, Arcium
```

## Deploying (Vercel)

Live at https://blackthorn-chat.vercel.app.

On Vercel the build downloads the pinned Linux `blackthorn` client
(`scripts/fetch-blackthorn.mjs`, checksum-verified) and the server routes start
it on demand (`lib/client-process.ts`). Set two environment variables in the
Vercel project:

- `BLACKTHORN_TOKEN` – your Blackthorn API key
- `APP_PASSWORD` – the shared access password

```bash
vercel deploy --prod
```

Alternatively, set `BLACKTHORN_BASE_URL` to a Blackthorn client you host
yourself and leave `BLACKTHORN_TOKEN` unset.
