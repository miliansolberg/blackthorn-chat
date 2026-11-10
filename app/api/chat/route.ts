import type { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { baseUrl, resolveModel, upstreamHeaders } from "@/lib/blackthorn";

export const maxDuration = 300;

const MAX_MESSAGES = 200;
const MAX_CHARS = 400_000;

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseMessages(body: unknown): ChatMessage[] | null {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;

  let chars = 0;
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as ChatMessage)?.role;
    const content = (item as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    chars += content.length;
    messages.push({ role, content });
  }
  if (chars > MAX_CHARS || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (!isAuthed(request)) return error("Not signed in.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON.", 400);
  }
  const messages = parseMessages(body);
  if (!messages) return error("Invalid messages.", 400);

  const system = process.env.SYSTEM_PROMPT;
  const payload = {
    model: "",
    stream: true,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
  };

  let upstream: Response;
  try {
    payload.model = await resolveModel();
    upstream = await fetch(`${await baseUrl()}/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(payload),
      signal: request.signal, // stop generating when the browser disconnects
      cache: "no-store",
    });
  } catch (cause) {
    console.error("Blackthorn endpoint unreachable:", cause);
    return error("Could not reach the Blackthorn endpoint.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error(`Blackthorn endpoint returned ${upstream.status}:`, detail.slice(0, 500));
    return error(`The Blackthorn endpoint returned an error (${upstream.status}).`, 502);
  }

  // Pass the server-sent events straight through to the browser.
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
