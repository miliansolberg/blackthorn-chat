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
const MAX_CHARS = 400_000;
/** Most web searches the model may run for one reply. */
const MAX_SEARCHES = 3;

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

  let text = "";
  const calls: ToolCall[] = [];
  for await (const event of sseEvents(res.body)) {
    const failure = (event.error as { message?: string } | undefined)?.message;
    if (failure) throw new Error(failure);

    const delta = (event.choices as { delta?: Record<string, unknown> }[] | undefined)?.[0]
      ?.delta;
    if (!delta) continue;
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      onText(delta.content);
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
  return { text, calls: calls.filter(Boolean) };
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
        for (;;) {
          const { text, calls } = await modelTurn(
            url,
            model,
            conversation,
            searching && searches < MAX_SEARCHES,
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
            } else if (searches >= MAX_SEARCHES) {
              content = "Search limit reached. Answer from what you already have.";
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
