import type { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import {
  baseUrl,
  clientMode,
  displayName,
  resolveModel,
  upstreamHeaders,
} from "@/lib/blackthorn";
import {
  MAX_CONNECTORS,
  openConnectors,
  toolDefinitions,
  type ConnectorConfig,
  type ConnectorSession,
} from "@/lib/mcp";
import { SEARCH_TOOL, formatResults, searchProvider, webSearch } from "@/lib/search";
import { sseEvents } from "@/lib/stream";
import { buildSystemPrompt } from "@/lib/system-prompt";

export const maxDuration = 300;

const MAX_MESSAGES = 200;
const MAX_CHARS = 500_000;
/** Most web searches the model may run for one reply. */
const MAX_SEARCHES = 4;
/** Most tool-using model turns for one reply; the last one runs without tools. */
const MAX_TURNS = 8;
/** Longest custom system prompt accepted from Settings. */
const MAX_INSTRUCTION_CHARS = 8000;
/** Most connector tool calls for one reply. */
const MAX_TOOL_CALLS = 12;
/**
 * Tokens the model may write in one turn. Blackthorn's own default is 512,
 * which cut long replies short. A reply that still hits this limit is
 * continued automatically.
 */
const MAX_REPLY_TOKENS = Number(process.env.MAX_REPLY_TOKENS) || 16_384;
/** Most automatic continuations of one reply within a request. */
const MAX_CONTINUATIONS = 40;
/**
 * Stop before the hosting time limit (maxDuration) so the stream can end
 * cleanly; the browser then asks for the rest in a new request.
 */
const SOFT_DEADLINE_MS = Number(process.env.SOFT_DEADLINE_MS) || 240_000;
const CONTINUE_PROMPT =
  "Continue your previous message from exactly where it stopped. Do not repeat anything already written, do not add an introduction or a note about continuing; begin with the very next word.";

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

function parseMessages(body: unknown, continuing: boolean): ChatMessage[] | null {
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
  // A continuation ends with the partial reply; a new message ends with the user.
  if (chars > MAX_CHARS || !last.content || last.role !== (continuing ? "assistant" : "user")) {
    return null;
  }
  return messages;
}

/**
 * A continued reply starts a fresh piece of text, which usually lacks the
 * space that belonged between it and the piece before. Returns what to put
 * between the two.
 */
function seam(previous: string, next: string): string {
  if (!previous || !next) return "";
  if (/\s$/.test(previous) || /^\s/.test(next)) return "";
  if (/[-(\[{"'“‘/#*_`]$/.test(previous)) return "";
  if (/^[.,;:!?)\]}'"’”%]/.test(next)) return "";
  return " ";
}

/** The sampling settings Blackthorn accepts, checked against its ranges. */
function parseSampling(raw: unknown): Record<string, number> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const sampling: Record<string, number> = {};
  const take = (from: string, to: string, min: number, max: number, integer = false) => {
    const value = input[from];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return;
    sampling[to] = integer ? Math.round(value) : value;
  };
  take("temperature", "temperature", 0, 2);
  take("topP", "top_p", 0.01, 1);
  take("topK", "top_k", 1, 500, true);
  take("repetitionPenalty", "repetition_penalty", 1, 2);
  return sampling;
}

function parseConnectors(raw: unknown): ConnectorConfig[] {
  if (!Array.isArray(raw)) return [];
  const connectors: ConnectorConfig[] = [];
  for (const item of raw.slice(0, MAX_CONNECTORS)) {
    const { name, url, token } = (item ?? {}) as Record<string, unknown>;
    if (typeof url !== "string" || !url || url.length > 2000) continue;
    connectors.push({
      name: (typeof name === "string" && name.trim() ? name.trim() : "Connector").slice(0, 60),
      url,
      token: typeof token === "string" ? token.slice(0, 4000) : "",
    });
  }
  return connectors;
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
  tools: unknown[],
  sampling: Record<string, number>,
  signal: AbortSignal,
  onText: (text: string) => void,
  onReasoning: (text: string) => void,
): Promise<{ text: string; calls: ToolCall[]; finish: string | null; usedTokens: number | null }> {
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: upstreamHeaders(),
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      max_tokens: MAX_REPLY_TOKENS,
      ...sampling,
      ...(tools.length > 0 ? { tools } : {}),
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
  let finish: string | null = null;
  let usedTokens: number | null = null;

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

    const total = (event.usage as { total_tokens?: unknown } | undefined)?.total_tokens;
    if (typeof total === "number") usedTokens = total;

    const choice = (
      event.choices as { delta?: Record<string, unknown>; finish_reason?: unknown }[] | undefined
    )?.[0];
    if (typeof choice?.finish_reason === "string") finish = choice.finish_reason;
    const delta = choice?.delta;
    if (!delta) continue;
    // Shown as-is when a model sends its reasoning separately; this one does not.
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string" && reasoning) onReasoning(reasoning);
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
    finish,
    usedTokens,
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
  const options = body as {
    model?: unknown;
    search?: unknown;
    continue?: unknown;
    sampling?: unknown;
    connectors?: unknown;
    instructions?: unknown;
  };
  const continuing = options.continue === true;
  const messages = parseMessages(body, continuing);
  if (!messages) {
    return error("The message could not be sent. It may be empty or the attached files too long.", 400);
  }
  let url: string;
  let model: string;
  let contextWindow: number | null;
  let mode: "bundled" | "external";
  try {
    const info = await resolveModel(typeof options.model === "string" ? options.model : undefined);
    model = info.id;
    contextWindow = info.contextWindow;
    url = await baseUrl();
    mode = await clientMode();
  } catch (cause) {
    console.error("Blackthorn endpoint unreachable:", cause);
    return error("Could not reach the Blackthorn endpoint.", 502);
  }

  const provider = searchProvider();
  const searching = provider !== null && options.search === true;
  const sampling = parseSampling(options.sampling);
  const connectorConfigs = parseConnectors(options.connectors);
  const conversation: UpstreamMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        modelName: displayName(model),
        clientMode: mode,
        searchProvider: searching ? provider.name : null,
        searchAvailable: provider !== null,
        connectors: connectorConfigs.map((connector) => connector.name),
        extra: process.env.SYSTEM_PROMPT,
        userInstructions:
          typeof options.instructions === "string"
            ? options.instructions.trim().slice(0, MAX_INSTRUCTION_CHARS)
            : "",
      }),
    },
    ...messages,
    ...(continuing ? [{ role: "user" as const, content: CONTINUE_PROMPT }] : []),
  ];

  // One signal for "the browser left" and "we are near the hosting time limit".
  const upstream = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    upstream.abort();
  }, SOFT_DEADLINE_MS);
  request.signal.addEventListener("abort", () => upstream.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let connectors: ConnectorSession | null = null;
      try {
        if (connectorConfigs.length > 0) {
          send({ stage: "connectors" });
          connectors = await openConnectors(connectorConfigs);
          for (const status of connectors.status) send({ connector: status });
        }
        const connectorTools = connectors?.tools ?? [];
        const tools = [...(searching ? [SEARCH_TOOL] : []), ...toolDefinitions(connectorTools)];

        let searches = 0;
        let toolCalls = 0;
        let toolTurns = 0;
        let continuations = 0;
        // Text written before a tool call is separated from what follows it.
        let afterTools = false;
        // Text a continued piece must be joined to (the partial reply so far).
        let joinTo = continuing ? messages[messages.length - 1].content : "";
        // Tools stay on for every turn so calls arrive in structured form; the
        // search limit is enforced when a call is answered, and the number of
        // tool turns is capped so a model that keeps calling cannot loop forever.
        for (;;) {
          send({ stage: "model" });
          const { text, calls, finish, usedTokens } = await modelTurn(
            url,
            model,
            conversation,
            toolTurns < MAX_TURNS - 1 ? tools : [],
            sampling,
            upstream.signal,
            (delta) => {
              send({ delta: (afterTools ? "\n\n" : seam(joinTo, delta)) + delta });
              joinTo = "";
              afterTools = false;
            },
            (reasoning) => send({ reasoning }),
          );
          if (usedTokens !== null) send({ usage: { used: usedTokens, window: contextWindow } });

          if (calls.length === 0) {
            // Cut off by the per-turn limit: ask for the rest and keep going.
            if (finish === "length" && text && continuations < MAX_CONTINUATIONS) {
              continuations += 1;
              conversation.push({ role: "assistant", content: text });
              conversation.push({ role: "user", content: CONTINUE_PROMPT });
              joinTo = text;
              send({ stage: "continue" });
              continue;
            }
            break;
          }
          if (++toolTurns >= MAX_TURNS) break;
          if (text) afterTools = true;

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
            let args: Record<string, unknown> = {};
            try {
              const parsed: unknown = JSON.parse(call.arguments || "{}");
              if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
            } catch {
              // handled below as an invalid call
            }
            const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
            const connectorTool = connectorTools.find((tool) => tool.name === call.name);

            let content: string;
            if (connectorTool) {
              const label = { connector: connectorTool.connector, name: connectorTool.toolName };
              if (toolCalls >= MAX_TOOL_CALLS) {
                content = "Tool call limit reached. Answer now from what you already have.";
              } else {
                toolCalls += 1;
                send({ tool: { ...label, status: "calling" } });
                try {
                  content = await connectorTool.call(args);
                  send({ tool: { ...label, status: "done" } });
                } catch (cause) {
                  console.error(`Connector tool ${call.name} failed:`, cause);
                  send({ tool: { ...label, status: "failed" } });
                  content = "The tool call failed. Continue without it and say that it failed.";
                }
              }
            } else if (call.name !== "web_search" || !query) {
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
        send({ done: true });
      } catch (cause) {
        if (timedOut) {
          // Out of time for this request: the browser asks for the rest.
          send({ truncated: true });
        } else if (!request.signal.aborted) {
          console.error("Chat failed:", cause);
          send({
            error:
              cause instanceof Error && cause.message.startsWith("The Blackthorn endpoint")
                ? cause.message
                : "Could not reach the Blackthorn endpoint.",
          });
        }
      } finally {
        clearTimeout(deadline);
        await connectors?.close();
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
