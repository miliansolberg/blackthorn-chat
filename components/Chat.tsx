"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Explain how encrypted inference keeps a prompt private",
  "Draft a short, friendly out-of-office reply",
  "Give me three ideas for a weekend side project",
];

/** Reads an OpenAI-style server-sent event stream and yields the text deltas. */
async function* readDeltas(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error.message ?? "The model returned an error.");
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) yield delta;
    }
  }
}

/**
 * Blackthorn delivers text in large sealed blocks a few seconds apart. This
 * reveals the reply at the measured generation speed instead of block by block.
 */
function createReveal(signal: AbortSignal, onShow: (text: string) => void) {
  const startedAt = performance.now();
  let received = "";
  let shown = 0;
  let rate = 0; // characters per second
  let finished = false;
  let done: () => void = () => {};
  const drained = new Promise<void>((resolve) => (done = resolve));

  let last = performance.now();
  let carry = 0;
  // A timer rather than animation frames, so a background tab still finishes.
  const timer = setInterval(() => {
    const now = performance.now();
    const backlog = received.length - shown;
    if (signal.aborted || (finished && backlog === 0)) {
      clearInterval(timer);
      return done();
    }
    if (backlog > 0) {
      carry += rate * ((now - last) / 1000);
      const step = Math.min(backlog, Math.floor(carry));
      if (step > 0) {
        carry -= step;
        shown += step;
        onShow(received.slice(0, shown));
      }
    } else {
      carry = 0;
    }
    last = now;
  }, 30);

  return {
    push(delta: string) {
      received += delta;
      const seconds = (performance.now() - startedAt) / 1000;
      rate = Math.min(2000, Math.max(40, received.length / seconds));
    },
    /** Everything has arrived: speed up a little, but keep the flow even. */
    finish() {
      rate = Math.max(rate, Math.min((received.length - shown) / 1.5, rate * 1.6));
      finished = true;
      return drained;
    },
    received: () => received,
    shown: () => received.slice(0, shown),
  };
}

export function Chat({
  model,
  gated,
  onSignedOut,
}: {
  model: string | null;
  gated: boolean;
  onSignedOut: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const chatIdRef = useRef(0); // bumped by "New chat" so a stopped reply cannot reappear
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Follow the stream unless the reader has scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function resizeInput() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);
    stickRef.current = true;
    requestAnimationFrame(resizeInput);

    const controller = new AbortController();
    abortRef.current = controller;
    const chatId = chatIdRef.current;
    const current = () => chatIdRef.current === chatId;
    const reveal = createReveal(controller.signal, (text) => {
      if (current()) setMessages([...history, { role: "assistant", content: text }]);
    });

    let answer = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        onSignedOut();
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      for await (const delta of readDeltas(res.body)) reveal.push(delta);
      if (!reveal.received()) throw new Error("The model returned an empty reply.");
      await reveal.finish();
      answer = reveal.received();
    } catch (cause) {
      if (controller.signal.aborted) {
        answer = reveal.shown(); // Stop keeps what was on screen
      } else {
        answer = reveal.received();
        if (current()) setError(cause instanceof Error ? cause.message : "Something went wrong.");
      }
      // Keep a partial answer; otherwise drop the empty placeholder.
      if (current()) {
        setMessages(answer ? [...history, { role: "assistant", content: answer }] : history);
      }
    } finally {
      controller.abort(); // ends the reveal loop on every path
      setStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function newChat() {
    chatIdRef.current += 1;
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function signOut() {
    abortRef.current?.abort();
    await fetch("/api/login", { method: "DELETE" }).catch(() => null);
    onSignedOut();
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="font-semibold leading-tight">Blackthorn Chat</h1>
          <p className="truncate text-xs text-muted">
            <span
              className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${
                model ? "bg-emerald-500" : "bg-danger"
              }`}
            />
            {model ? `Encrypted inference · ${model}` : "Blackthorn endpoint unreachable"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-sm">
          <button
            onClick={newChat}
            disabled={empty}
            className="rounded-lg px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40"
          >
            New chat
          </button>
          {gated && (
            <button
              onClick={signOut}
              className="rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {empty ? (
            <div className="m-auto w-full max-w-md text-center">
              <h2 className="text-xl font-semibold">What would you like to ask?</h2>
              <p className="mt-2 text-sm text-muted">
                Prompts are sealed by the Blackthorn client before they reach the GPU.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => send(suggestion)}
                    className="rounded-xl border border-border bg-surface px-4 py-2.5 text-left text-sm hover:border-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) =>
              message.role === "user" ? (
                <div
                  key={index}
                  className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-surface-2 px-4 py-2.5 [overflow-wrap:anywhere]"
                >
                  {message.content}
                </div>
              ) : (
                <div key={index} className="prose-chat">
                  {message.content ? (
                    <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                  ) : (
                    <span className="animate-pulse text-muted">Thinking…</span>
                  )}
                </div>
              ),
            )
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-danger/40 px-4 py-2.5 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="mx-auto w-full max-w-3xl px-4 pb-4"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-accent">
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <textarea
            id="message"
            ref={inputRef}
            autoFocus
            rows={1}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              resizeInput();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(input);
              }
            }}
            placeholder="Send a message"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl border border-border px-4 py-1.5 font-medium hover:bg-surface-2"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-accent px-4 py-1.5 font-medium text-accent-text disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
