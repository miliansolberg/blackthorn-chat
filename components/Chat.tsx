"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createChat,
  loadChats,
  loadModel,
  saveChats,
  saveModel,
  touched,
  type ChatRecord,
  type Message,
} from "@/lib/chats";
import { createReveal, readDeltas } from "@/lib/stream";
import { Sidebar } from "./Sidebar";
import { ThinkingIndicator } from "./ThinkingIndicator";

type ModelInfo = { id: string; name: string };

const NO_MESSAGES: Message[] = [];

const SUGGESTIONS = [
  "Explain how encrypted inference keeps a prompt private",
  "Draft a short, friendly out-of-office reply",
  "Give me three ideas for a weekend side project",
];

export function Chat({
  models,
  gated,
  onSessionChange,
}: {
  models: ModelInfo[];
  gated: boolean;
  onSessionChange: () => void;
}) {
  // This component only mounts in the browser, after the session check.
  const [chats, setChats] = useState<ChatRecord[]>(loadChats);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ chatId: string; message: string } | null>(null);
  const [input, setInput] = useState("");
  const [savedModel, setSavedModel] = useState(loadModel);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const deletedRef = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const model = models.find((item) => item.id === savedModel)?.id ?? models[0]?.id ?? "";
  const active = chats.find((chat) => chat.id === activeId) ?? null;
  const messages = active?.messages ?? NO_MESSAGES;
  const empty = messages.length === 0;
  const busy = busyId !== null;

  // Save shortly after changes settle, and right away when the page is hidden.
  useEffect(() => {
    const timer = setTimeout(() => saveChats(chats), 300);
    const flush = () => saveChats(chats);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [chats]);

  // Follow the stream unless the reader has scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

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
    if (!content || busy || !model) return;

    const record = touched(active ?? createChat(content), []);
    const chatId = record.id;
    const history: Message[] = [...(active?.messages ?? []), { role: "user", content }];
    const alive = () => !deletedRef.current.has(chatId);
    const write = (next: Message[]) =>
      setChats((previous) => {
        if (!alive()) return previous;
        const updated = { ...record, messages: next };
        return previous.some((chat) => chat.id === chatId)
          ? previous.map((chat) => (chat.id === chatId ? updated : chat))
          : [updated, ...previous];
      });

    write([...history, { role: "assistant", content: "" }]);
    setActiveId(chatId);
    setBusyId(chatId);
    setInput("");
    setError(null);
    stickRef.current = true;
    requestAnimationFrame(resizeInput);

    const controller = new AbortController();
    abortRef.current = controller;
    const reveal = createReveal(controller.signal, (shown) =>
      write([...history, { role: "assistant", content: shown }]),
    );

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, model }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        write(history);
        onSessionChange();
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      for await (const delta of readDeltas(res.body)) reveal.push(delta);
      if (!reveal.received()) throw new Error("The model returned an empty reply.");
      await reveal.finish();
      write([...history, { role: "assistant", content: reveal.received() }]);
    } catch (cause) {
      // Stop keeps what was on screen; a failure keeps everything that arrived.
      const stopped = controller.signal.aborted;
      const answer = stopped ? reveal.shown() : reveal.received();
      if (!stopped && alive()) {
        setError({
          chatId,
          message: cause instanceof Error ? cause.message : "Something went wrong.",
        });
      }
      write(answer ? [...history, { role: "assistant", content: answer }] : history);
    } finally {
      controller.abort(); // ends the reveal loop on every path
      setBusyId(null);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function newChat() {
    setActiveId(null);
    setSidebarOpen(false);
    stickRef.current = true;
    inputRef.current?.focus();
  }

  function selectChat(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
    stickRef.current = true;
  }

  function deleteChat(id: string) {
    deletedRef.current.add(id);
    if (busyId === id) abortRef.current?.abort();
    setChats((previous) => previous.filter((chat) => chat.id !== id));
    if (activeId === id) setActiveId(null);
    if (error?.chatId === id) setError(null);
  }

  async function signOut() {
    abortRef.current?.abort();
    await fetch("/api/login", { method: "DELETE" }).catch(() => null);
    onSessionChange();
  }

  return (
    <div className="flex h-dvh">
      <Sidebar
        chats={chats}
        activeId={activeId}
        busyId={busyId}
        open={sidebarOpen}
        gated={gated}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectChat}
        onNew={newChat}
        onDelete={deleteChat}
        onSignOut={signOut}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open chat list"
          className="absolute left-3 top-3 z-10 rounded-lg border border-border bg-surface p-2 md:hidden"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 pb-6 pt-16 md:pt-8">
            {empty ? (
              <div className="m-auto w-full max-w-md text-center">
                <h1 className="text-xl font-semibold">What would you like to ask?</h1>
                <p className="mt-2 text-sm text-muted">
                  Prompts are sealed by the Blackthorn client before they reach the GPU.
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => send(suggestion)}
                      disabled={busy || !model}
                      className="rounded-xl border border-border bg-surface px-4 py-2.5 text-left text-sm hover:border-accent disabled:opacity-50"
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
                ) : message.content ? (
                  <div key={index} className="prose-chat">
                    <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                  </div>
                ) : (
                  <div key={index} className="py-1">
                    <ThinkingIndicator />
                  </div>
                ),
              )
            )}
            {error && error.chatId === activeId && (
              <p
                role="alert"
                className="rounded-xl border border-danger/40 px-4 py-2.5 text-sm text-danger"
              >
                {error.message}
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
          <div className="rounded-2xl border border-border bg-surface p-2 focus-within:border-accent">
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
              className="block max-h-[200px] w-full resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              {models.length > 0 ? (
                <div className="relative min-w-0">
                  <label htmlFor="model" className="sr-only">
                    Model
                  </label>
                  <select
                    id="model"
                    value={model}
                    onChange={(event) => {
                      setSavedModel(event.target.value);
                      saveModel(event.target.value);
                    }}
                    className="max-w-full cursor-pointer appearance-none truncate rounded-lg border border-border bg-surface py-1.5 pl-3 pr-8 text-sm hover:border-accent focus:border-accent focus:outline-none"
                  >
                    {models.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <svg
                    viewBox="0 0 16 16"
                    width="12"
                    height="12"
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
                  >
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ) : (
                <p className="px-2 text-sm text-danger">
                  Blackthorn endpoint unreachable.{" "}
                  <button type="button" onClick={onSessionChange} className="underline">
                    Retry
                  </button>
                </p>
              )}
              {busy ? (
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
                  disabled={!input.trim() || !model}
                  className="rounded-xl bg-accent px-4 py-1.5 font-medium text-accent-text disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
