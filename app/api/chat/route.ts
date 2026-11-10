import type { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import {
  baseUrl,
  clientMode,
  displayName,
  resolveModel,
  upstreamHeaders,
} from "@/lib/blackthorn";
import { SEARCH_TOOL, formatResults, searchProvider, webSearch } from "@/lib/search";
import { sseEvents } from "@/lib/stream";
import { buildSystemPrompt } from "@/lib/system-prompt";

export const maxDuration = 300;

const MAX_MESSAGES = 200;
const MAX_CHARS = 500_000;
/** Most web searches the model may run for one reply. */
const MAX_SEARCHES = 4;
/** Most model turns for one reply; the last one runs without tools. */
const MAX_TURNS = 6;

type ChatMessage = { role: "user" | "assistant"; content: string };
type ToolCall = { id: string; name: string; arguments: string };
type UpstreamMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

const MAX_ATTACHMENTS = 10;

/** A user message's files, folded into its text for the model. */
function withAttachments(content: string, raw: unknown): string | null {
  if (raw === undefined) return content;
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;

  const blocks: string[] = [];
  for (const item of raw) {
    const { name, kind, text, truncated } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof text !== "string") return null;
    const label = name.replace(/["<>\n\r]/g, " ").slice(0, 200);
    const notes: string[] = [];
    if (kind === "image") {
      notes.push(
        text
          ? "This is an image. You cannot see it; below is the text read from it by OCR, which may contain errors."
          : "This is an image. You cannot see it, and no readable text was found in it.",
      );
    } else if (!text) {
      notes.push("The contents of this file are no longer available.");
    }
    if (truncated === true) notes.push("The file was long and has been cut off.");
    blocks.push(
      `<attached_file name="${label}">\n${[...notes.map((note) => `[${note}]`), text]
        .filter(Boolean)
        .join("\n")}\n</attached_file>`,
    );
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n\n${content}`.trim() : content;
}

function parseMessages(body: unknown): ChatMessage[] | null {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;

  let chars = 0;
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as ChatMessage)?.role;
    const text = (item as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") {
      return null;
    }
    const content =
      role === "user"
        ? withAttachments(text, (item as { attachments?: unknown }).attachments)
        : text;
    if (content === null) return null;
    chars += content.length;
    messages.push({ role, content });
  }
  const last = messages[messages.length - 1];
  if (chars > MAX_CHARS || last.role !== "user" || !last.content) return null;
  return messages;
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/**
 * Streams one model turn. Text is forwarded as it arrives; tool calls are
 * collected and returned.
 */
async function modelTurn(
  url: string,
  model: string,
  messages: UpstreamMessage[],
  withTools: boolean,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<{ text: string; calls: ToolCall[] }> {
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: upstreamHeaders(),
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      ...(withTools ? { tools: [SEARCH_TOOL] } : {}),
    }),
    signal,
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error(`Blackthorn endpoint returned ${res.status}:`, detail.slice(0, 500));
    throw new Error(`The Blackthorn endpoint returned an error (${res.status}).`);
  }

  let raw = ""; // everything the model wrote
  let emitted = 0; // how much of it has been forwarded
  let marker = -1; // where tool-call markup begins, once seen
  const calls: ToolCall[] = [];

  // Forward text as it arrives, but never tool-call markup: the model sometimes
  // writes its calls as text ("<tool_call>…") instead of structured calls.
  const forward = (final: boolean) => {
    if (marker < 0) marker = raw.indexOf(TOOL_MARKER);
    let end = marker >= 0 ? marker : raw.length;
    if (marker < 0 && !final) {
      // Hold back a tail that could be the start of the marker.
      for (let size = Math.min(TOOL_MARKER.length - 1, raw.length); size > 0; size--) {
        if (TOOL_MARKER.startsWith(raw.slice(raw.length - size))) {
          end = raw.length - size;
          break;
        }
      }
    }
    if (end > emitted) {
      onText(raw.slice(emitted, end));
      emitted = end;
    }
  };

  for await (const event of sseEvents(res.body)) {
    const failure = (event.error as { message?: string } | undefined)?.message;
    if (failure) throw new Error(failure);

    const delta = (event.choices as { delta?: Record<string, unknown> }[] | undefined)?.[0]
      ?.delta;
    if (!delta) continue;
    if (typeof delta.content === "string" && delta.content) {
      raw += delta.content;
      forward(false);
    }
    const parts = delta.tool_calls as
      | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
      | undefined;
    for (const part of parts ?? []) {
      const call = (calls[part.index ?? 0] ??= { id: "", name: "", arguments: "" });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name = part.function.name;
      if (part.function?.arguments) call.arguments += part.function.arguments;
    }
  }
  forward(true);

  const structured = calls.filter(Boolean);
  return {
    text: marker >= 0 ? raw.slice(0, marker).trimEnd() : raw,
    calls: structured.length > 0 || marker < 0 ? structured : parseTextCalls(raw.slice(marker)),
  };
}

const TOOL_MARKER = "<tool_call";

/**
 * Reads tool calls the model wrote as text. Two shapes occur:
 *   <tool_call><function=web_search><parameter=query>…</parameter></function></tool_call>
 *   <tool_call>{"name": "web_search", "arguments": {"query": "…"}}</tool_call>
 */
function parseTextCalls(markup: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const add = (name: string, args: Record<string, unknown>) =>
    calls.push({
      id: `call_text_${calls.length}_${Math.random().toString(36).slice(2, 10)}`,
      name,
      arguments: JSON.stringify(args),
    });

  for (const match of markup.matchAll(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/g)) {
    const args: Record<string, unknown> = {};
    for (const parameter of match[2].matchAll(
      /<parameter=([\w.-]+)>([\s\S]*?)(?:<\/parameter>|$)/g,
    )) {
      args[parameter[1]] = parameter[2].trim();
    }
    add(match[1], args);
  }
  if (calls.length === 0) {
    for (const match of markup.matchAll(/<tool_call>\s*(\{[\s\S]*?\})\s*(?:<\/tool_call>|$)/g)) {
      try {
        const parsed = JSON.parse(match[1]) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name !== "string") continue;
        const args =
          typeof parsed.arguments === "string"
            ? (JSON.parse(parsed.arguments) as Record<string, unknown>)
            : ((parsed.arguments as Record<string, unknown>) ?? {});
        add(parsed.name, args);
      } catch {
        // not a call we can read
      }
    }
  }
  return calls;
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
  if (!messages) {
    return error("The message could not be sent. It may be empty or the attached files too long.", 400);
  }
  const options = body as { model?: unknown; search?: unknown };

  let url: string;
  let model: string;
  let mode: "bundled" | "external";
  try {
    model = await resolveModel(typeof options.model === "string" ? options.model : undefined);
    url = await baseUrl();
    mode = await clientMode();
  } catch (cause) {
    console.error("Blackthorn endpoint unreachable:", cause);
    return error("Could not reach the Blackthorn endpoint.", 502);
  }

  const provider = searchProvider();
  const searching = provider !== null && options.search === true;
  const conversation: UpstreamMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        modelName: displayName(model),
        clientMode: mode,
        searchProvider: searching ? provider.name : null,
        searchAvailable: provider !== null,
        extra: process.env.SYSTEM_PROMPT,
      }),
    },
    ...messages,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        let searches = 0;
        // Tools stay on for every turn so calls arrive in structured form; the
        // search limit is enforced when a call is answered, and the number of
        // turns is capped so a model that keeps calling cannot loop forever.
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const { text, calls } = await modelTurn(
            url,
            model,
            conversation,
            searching && turn < MAX_TURNS - 1,
            request.signal, // stop generating when the browser disconnects
            (delta) => send({ delta }),
          );
          if (calls.length === 0) break;

          conversation.push({
            role: "assistant",
            content: text || null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          });
          for (const call of calls) {
            let query = "";
            try {
              const parsed = JSON.parse(call.arguments) as { query?: unknown };
              if (typeof parsed.query === "string") query = parsed.query.trim().slice(0, 300);
            } catch {
              // handled below
            }

            let content: string;
            if (call.name !== "web_search" || !query) {
              content = "Invalid tool call. Answer without it.";
            } else if (!searching) {
              content = "Web search is off for this message. Answer without searching.";
            } else if (searches >= MAX_SEARCHES) {
              content =
                "Search limit reached. Do not search again; answer now from the results you already have.";
            } else {
              searches += 1;
              send({ search: { status: "searching", query } });
              try {
                const results = await webSearch(query);
                send({
                  search: {
                    status: "done",
                    query,
                    results: results.map(({ title, url: link }) => ({ title, url: link })),
                  },
                });
                content = formatResults(query, results);
              } catch (cause) {
                console.error("Web search failed:", cause);
                send({ search: { status: "failed", query } });
                content =
                  "The web search failed. Answer from what you know and say that you could not search.";
              }
            }
            conversation.push({ role: "tool", tool_call_id: call.id, content });
          }
        }
      } catch (cause) {
        if (!request.signal.aborted) {
          console.error("Chat failed:", cause);
          send({
            error:
              cause instanceof Error && cause.message.startsWith("The Blackthorn endpoint")
                ? cause.message
                : "Could not reach the Blackthorn endpoint.",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a disconnect
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
