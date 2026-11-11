"use client";

import { useEffect, useRef, useState } from "react";
import { DICTATION_LANGUAGES } from "@/lib/dictation";
import { parseExport } from "@/lib/import";
import type { ChatRecord } from "@/lib/chats";
import {
  MAX_CONNECTORS,
  newConnector,
  type Connector,
  type Sampling,
  type Settings as SettingsValue,
} from "@/lib/settings";

type Tab = "general" | "model" | "connectors" | "import";
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "model", label: "Model" },
  { id: "connectors", label: "Connectors" },
  { id: "import", label: "Import chats" },
];

export function Settings({
  settings,
  dictationSupported,
  onChange,
  onImport,
  onClose,
}: {
  settings: SettingsValue;
  dictationSupported: boolean;
  onChange: (settings: SettingsValue) => void;
  /** Adds imported chats; returns how many were new. */
  onImport: (chats: ChatRecord[]) => number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[min(620px,90dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl shadow-black/40 md:flex-row"
      >
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface p-2 md:w-48 md:flex-col md:border-b-0 md:border-r md:p-3">
          <p className="hidden px-3 pb-2 pt-1 font-semibold md:block">Settings</p>
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm ${
                tab === item.id ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-6 pt-5">
            <h2 className="text-lg font-semibold">{TABS.find((item) => item.id === tab)?.label}</h2>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
            {tab === "general" && (
              <General settings={settings} dictationSupported={dictationSupported} onChange={onChange} />
            )}
            {tab === "model" && (
              <Model
                sampling={settings.sampling}
                onChange={(sampling) => onChange({ ...settings, sampling })}
              />
            )}
            {tab === "connectors" && (
              <Connectors
                connectors={settings.connectors}
                onChange={(connectors) => onChange({ ...settings, connectors })}
              />
            )}
            {tab === "import" && <Import onImport={onImport} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border py-5 first:pt-0 last:border-b-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A row of mutually exclusive choices. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-surface p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-4 py-1.5 text-sm ${
            option.value === value ? "bg-send font-medium text-send-text" : "text-muted hover:text-text"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        checked ? "border-send bg-send" : "border-border bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-0.5 size-3.5 rounded-full transition-all ${
          checked ? "left-[18px] bg-send-text" : "left-0.5 bg-muted"
        }`}
      />
    </button>
  );
}

function General({
  settings,
  dictationSupported,
  onChange,
}: {
  settings: SettingsValue;
  dictationSupported: boolean;
  onChange: (settings: SettingsValue) => void;
}) {
  return (
    <>
      <Section title="Appearance">
        <Segmented
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          value={settings.theme}
          onChange={(theme) => onChange({ ...settings, theme })}
        />
      </Section>
      {dictationSupported && (
        <Section
          title="Dictation language"
          hint="The language you speak when using the microphone. Speech is transcribed on this device."
        >
          <div className="flex flex-wrap gap-1.5">
            {DICTATION_LANGUAGES.map((language) => {
              const selected = language.code === settings.dictationLanguage;
              return (
                <button
                  key={language.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ ...settings, dictationLanguage: language.code })}
                  className={`rounded-lg border px-3 py-1 text-sm ${
                    selected
                      ? "border-send bg-send text-send-text"
                      : "border-border text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  {language.name}
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

const PARAMETERS: {
  key: keyof Sampling;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  start: number;
}[] = [
  {
    key: "temperature",
    label: "Temperature",
    hint: "How varied the wording is. 0 gives the same answer every time; higher values are more creative and less predictable.",
    min: 0,
    max: 2,
    step: 0.05,
    start: 0.7,
  },
  {
    key: "topP",
    label: "Top P",
    hint: "Limits choices to the most likely words that together make up this share of probability. Lower is more focused.",
    min: 0.05,
    max: 1,
    step: 0.05,
    start: 0.9,
  },
  {
    key: "topK",
    label: "Top K",
    hint: "Limits choices to this many of the most likely next words. Lower is more focused.",
    min: 1,
    max: 200,
    step: 1,
    start: 40,
  },
  {
    key: "repetitionPenalty",
    label: "Repetition penalty",
    hint: "Discourages repeating words already used. 1 is off; higher values repeat less.",
    min: 1,
    max: 2,
    step: 0.05,
    start: 1.1,
  },
];

function Model({ sampling, onChange }: { sampling: Sampling; onChange: (sampling: Sampling) => void }) {
  const custom = PARAMETERS.some((parameter) => sampling[parameter.key] !== null);
  return (
    <>
      <p className="pb-2 text-sm text-muted">
        These apply to every new message. A setting that is switched off uses the model&apos;s default,
        which gives the same answer each time for the same question.
      </p>
      {PARAMETERS.map((parameter) => {
        const value = sampling[parameter.key];
        const active = value !== null;
        return (
          <Section key={parameter.key} title={parameter.label} hint={parameter.hint}>
            <div className="flex items-center gap-4">
              <Switch
                checked={active}
                label={`Set ${parameter.label}`}
                onChange={(checked) =>
                  onChange({ ...sampling, [parameter.key]: checked ? parameter.start : null })
                }
              />
              <input
                type="range"
                aria-label={parameter.label}
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                disabled={!active}
                value={value ?? parameter.start}
                onChange={(event) =>
                  onChange({ ...sampling, [parameter.key]: Number(event.target.value) })
                }
                className="slider min-w-0 flex-1"
              />
              <span className="w-14 shrink-0 text-right text-sm tabular-nums">
                {active ? (parameter.step < 1 ? value.toFixed(2) : value) : "Default"}
              </span>
            </div>
          </Section>
        );
      })}
      {custom && (
        <button
          type="button"
          onClick={() => onChange({ temperature: null, topP: null, topK: null, repetitionPenalty: null })}
          className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Reset to defaults
        </button>
      )}
    </>
  );
}

const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted";

function Connectors({
  connectors,
  onChange,
}: {
  connectors: Connector[];
  onChange: (connectors: Connector[]) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<Record<string, string>>({});

  async function check(target: { name: string; url: string; token: string }) {
    const res = await fetch("/api/connectors/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? "Could not connect.");
    return (body?.tools ?? []) as { name: string }[];
  }

  function summary(found: { name: string }[]): string {
    if (found.length === 0) return "Connected, but it offers no tools.";
    const names = found.slice(0, 6).map((tool) => tool.name).join(", ");
    return `${found.length} ${found.length === 1 ? "tool" : "tools"}: ${names}${found.length > 6 ? ", …" : ""}`;
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const label = name.trim() || new URL(url.trim()).hostname;
      const found = await check({ name: label, url: url.trim(), token: token.trim() });
      const connector = newConnector(label, url.trim(), token.trim());
      onChange([...connectors, connector]);
      setTools((previous) => ({ ...previous, [connector.id]: summary(found) }));
      setName("");
      setUrl("");
      setToken("");
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Enter a full address, starting with https://."
          : cause instanceof Error
            ? cause.message
            : "Could not connect.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recheck(connector: Connector) {
    setTools((previous) => ({ ...previous, [connector.id]: "Checking…" }));
    try {
      const found = await check(connector);
      setTools((previous) => ({ ...previous, [connector.id]: summary(found) }));
    } catch (cause) {
      setTools((previous) => ({
        ...previous,
        [connector.id]: cause instanceof Error ? cause.message : "Could not connect.",
      }));
    }
  }

  return (
    <>
      <p className="pb-4 text-sm text-muted">
        Connectors are remote MCP servers that give the model extra tools, such as looking things up
        in another service. What the model sends to a connector leaves Blackthorn&apos;s encryption
        and is seen by that service. Connectors that need a sign-in window (OAuth) are not supported;
        ones that are open or take a token are.
      </p>

      {connectors.length > 0 && (
        <ul className="mb-5 flex flex-col gap-2">
          {connectors.map((connector) => (
            <li key={connector.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={connector.enabled}
                  label={`Use ${connector.name}`}
                  onChange={(enabled) =>
                    onChange(
                      connectors.map((item) => (item.id === connector.id ? { ...item, enabled } : item)),
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{connector.name}</p>
                  <p className="truncate font-mono text-xs text-muted">{connector.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() => recheck(connector)}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
                >
                  Test
                </button>
                <button
                  type="button"
                  onClick={() => onChange(connectors.filter((item) => item.id !== connector.id))}
                  aria-label={`Remove ${connector.name}`}
                  className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {tools[connector.id] && (
                <p className="mt-2 text-xs text-muted [overflow-wrap:anywhere]">{tools[connector.id]}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {connectors.length < MAX_CONNECTORS ? (
        <form onSubmit={add} className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <p className="text-sm font-medium">Add a connector</p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (optional)"
            aria-label="Connector name"
            maxLength={60}
            className={fieldClass}
          />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/mcp"
            aria-label="Connector address"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className={`${fieldClass} font-mono`}
          />
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Access token (optional)"
            aria-label="Connector access token"
            type="password"
            autoComplete="off"
            className={fieldClass}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Saved in this browser only, and sent to the app&apos;s server with each message.
            </p>
            <button
              type="submit"
              disabled={!url.trim() || busy}
              className="shrink-0 rounded-lg bg-send px-4 py-1.5 text-sm font-medium text-send-text disabled:opacity-40"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">You can add up to {MAX_CONNECTORS} connectors.</p>
      )}
    </>
  );
}

function Import({ onImport }: { onImport: (chats: ChatRecord[]) => number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function read(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const { source, chats } = await parseExport(file);
      if (chats.length === 0) throw new Error(`No conversations with messages were found in this ${source} export.`);
      const added = onImport(chats);
      const skipped = chats.length - added;
      setResult({
        ok: true,
        text:
          `Imported ${added} ${added === 1 ? "chat" : "chats"} from ${source}.` +
          (skipped > 0 ? ` ${skipped} were already here.` : ""),
      });
    } catch (cause) {
      setResult({
        ok: false,
        text: cause instanceof Error ? cause.message : "This file could not be imported.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="pb-4 text-sm text-muted">
        Bring your conversations from Claude or ChatGPT into the chat list. The export file is read
        in this browser and the chats are stored only here; nothing is uploaded. You can continue an
        imported chat like any other.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) read(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file && !busy) read(file);
        }}
        className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border px-4 py-8 text-center hover:bg-surface disabled:opacity-60"
      >
        <span className="text-sm font-medium">
          {busy ? "Reading the export…" : "Choose an export file, or drop it here"}
        </span>
        <span className="text-xs text-muted">The export .zip, or the conversations.json inside it</span>
      </button>

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-3 text-sm ${result.ok ? "text-text" : "text-danger"}`}
        >
          {result.text}
        </p>
      )}

      <Section title="How to get your export">
        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li>
            <span className="font-medium text-text">Claude:</span> Settings, then Privacy, then
            Export data. A download link arrives by email.
          </li>
          <li>
            <span className="font-medium text-text">ChatGPT:</span> Settings, then Data controls,
            then Export data. A download link arrives by email.
          </li>
        </ul>
      </Section>
    </>
  );
}
