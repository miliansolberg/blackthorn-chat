# Blackthorn Chat

A simple chat interface for [Arcium Blackthorn](https://www.arcium.com/blackthorn)
encrypted inference. Next.js (App Router), streaming replies, markdown rendering,
a chat list saved in the browser, a model selector and an optional
shared-password gate.

Chat history is stored in the browser only (IndexedDB, unencrypted, per device);
deleting a chat in the left panel removes it from there.

## How it reaches Blackthorn

Blackthorn has no plain hosted HTTP API: the `blackthorn` client seals each
request on the machine it runs on and exposes an OpenAI-compatible API locally.
This app's server route forwards chat requests to that client:

```
browser ──HTTPS──> this app (/api/chat) ──> blackthorn serve ══sealed══> GPU
```

Prompts are plaintext up to the Blackthorn client and encrypted from there on.
Whoever runs this app and the client can therefore see them; the GPU host cannot.

## Long replies, context and activity

- Blackthorn stops a reply at 512 tokens unless told otherwise. The server asks
  for up to 16,384 tokens per turn and, if a reply still hits that limit, asks
  the model to continue. A reply that outlasts one server request (240 s) is
  picked up again by the browser until the model finishes.
- The circle in the message box shows how much of the model's context window
  the chat has used, from the token count Blackthorn reports.
- Clicking "Thinking…" opens the activity view: each step the app took, with
  timings. The current model does not send its reasoning separately; if a model
  does, it is shown there.

## Settings

Profile, then Settings:

- **General:** dark or light theme; dictation language (English by default).
- **Model:** temperature, top-p, top-k and repetition penalty, the sampling
  settings Blackthorn accepts. Each is off by default, which uses the model's
  default (the same answer every time).
- **Connectors:** remote MCP servers whose tools the model may call
  (`lib/mcp.ts`). The app's server connects to them, so what the model sends to
  a connector leaves Blackthorn's encryption. Open servers and ones that take a
  bearer token work; OAuth sign-in does not. Hosted deployments only accept
  public https addresses.
- **Import chats:** reads a Claude or ChatGPT data export (the .zip or its
  conversations.json) in the browser and adds the conversations to the chat
  list (`lib/import.ts`).

Settings are saved in the browser's localStorage. Chats are saved in the
browser's IndexedDB (they moved there from localStorage so that an imported
history fits).

## Web search

The model can search the web through a `web_search` tool when a search key is
configured and the user leaves the "Web search" toggle on:

- `TAVILY_API_KEY` – Tavily, free plan without a credit card.
- `BRAVE_API_KEY` – Brave Search (metered, credit card required). Used first
  when set, with Tavily as the backup if a Brave request fails.

Search queries are sent to that provider in plaintext, outside Blackthorn's
encryption. The model writes the query, the server runs it (`lib/search.ts`),
and the reply lists the sources. With no key set, the toggle is hidden.

## File attachments

Files can be attached with the paperclip, by pasting, or by dropping them on the
message box. They are converted to text in the browser (`lib/attachments.ts`)
and only that text is sent with the message; the original file is not uploaded.

- Text and code files, PDF, DOCX and XLSX: their text is extracted.
- Images: the current model reads text only, so images are read with on-device
  OCR (tesseract.js, English). The OCR engine's files load from a public CDN on
  first use; the image itself stays in the browser. Pictures without text
  cannot be understood.
- Limits: 10 files per message, 30 MB per file, 120,000 characters per file.

## Dictation

The microphone button records in the browser and transcribes on the device with
Whisper through transformers.js in a web worker (`lib/dictation.ts`,
`lib/whisper.worker.ts`). Audio is never uploaded. Text is inserted when the
recording is stopped, not while speaking.

- The dictation language is chosen in the Profile menu (the library cannot
  detect it), defaulting to the browser's language.
- English uses `onnx-community/whisper-base`; other languages use the larger
  `onnx-community/whisper-small`. Model files are downloaded once from Hugging
  Face and cached by the browser (about 450 MB for both together).

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
lib/chats.ts          chat history in the browser's IndexedDB
lib/settings.ts       theme, sampling settings and connectors
lib/import.ts         Claude and ChatGPT export import
lib/mcp.ts            connectors (remote MCP servers)
lib/stream.ts         stream parsing and steady text reveal
lib/search.ts         web search providers and the search tool
lib/attachments.ts    turns attached files into text in the browser
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
