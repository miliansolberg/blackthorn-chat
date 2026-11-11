"use client";

import { useEffect, useState } from "react";
import type { Attestation as AttestationResult } from "@/lib/attestation";

/**
 * Shows the Blackthorn client's attestation check, run by the app's server,
 * with the evidence in a form that can be copied.
 */
export function Attestation({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<AttestationResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/attestation", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: AttestationResult) => {
        if (!cancelled) setResult(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function recheck() {
    setResult(null);
    setFailed(false);
    setRun(run + 1);
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  const ok = result?.available ? result : null;
  const fullReport = ok
    ? [
        "Blackthorn attestation check",
        `Checked at: ${ok.checkedAt}`,
        `Checked by: ${ok.clientVersion ?? "blackthorn client"}, run on the app server (${location.host})`,
        "",
        ok.report,
      ].join("\n")
    : "";

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
        aria-label="Attestation"
        className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl shadow-black/40"
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-lg font-semibold">Attestation</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 pb-6 pt-3 text-sm">
          {failed ? (
            <p role="alert" className="text-danger">
              The check could not be run.{" "}
              <button onClick={recheck} className="underline">
                Try again
              </button>
            </p>
          ) : !result ? (
            <p role="status" className="py-6 text-muted">
              Checking the GPU&apos;s attestation…
            </p>
          ) : !result.available ? (
            <p className="text-muted">{result.reason}</p>
          ) : (
            <>
              <div
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  result.verified ? "border-border bg-surface" : "border-danger/50"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                    result.verified ? "bg-send text-send-text" : "bg-danger/15 text-danger"
                  }`}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d={result.verified ? "M3.500 8.500l3 3 6-7" : "M4 4l8 8M12 4l-8 8"}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <p className="font-medium">
                    {result.verified
                      ? "The GPU's attested session is vouched for"
                      : "The check did not pass"}
                  </p>
                  <p className="mt-0.5 text-muted">
                    {result.parties ?? result.access ?? "The client reported no attestation result."}
                  </p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <Row label="Host" value={result.host} />
                <Row label="Model" value={result.model} />
                <Row label="Access" value={result.access} />
                <Row label="Checked" value={new Date(result.checkedAt).toLocaleString()} />
                <Row label="Client" value={result.clientVersion} />
              </dl>

              {result.engineKey && (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Engine key</p>
                    <CopyButton
                      done={copied === "key"}
                      onClick={() => copy("key", result.engineKey as string)}
                    />
                  </div>
                  <p className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
                    {result.engineKey}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    The public key of the inference engine inside the GPU&apos;s protected memory.
                    The client only seals messages to a key that the network&apos;s parties have
                    signed for.
                  </p>
                </div>
              )}

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">Full report</p>
                  <CopyButton done={copied === "report"} onClick={() => copy("report", fullReport)} />
                </div>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs leading-5">
                  {fullReport}
                </pre>
              </div>

              <button
                onClick={recheck}
                className="mt-3 rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2"
              >
                Check again
              </button>

              <div className="mt-5 border-t border-border pt-4 text-muted">
                <p className="font-medium text-text">What this does and does not prove</p>
                <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
                  <li>
                    The check was run by the Blackthorn client on this app&apos;s server, not in your
                    browser. You are trusting the server to report it faithfully.
                  </li>
                  <li>
                    The client verifies the parties&apos; signatures over the GPU&apos;s attestation
                    and prints this summary. It does not output the underlying NVIDIA attestation
                    quote, so there is no quote here to check against NVIDIA yourself.
                  </li>
                  <li>
                    To check independently, install the Blackthorn client and run{" "}
                    <code className="rounded bg-surface-2 px-1 font-mono text-xs text-text">
                      blackthorn status
                    </code>{" "}
                    on your own machine. It performs the same verification against the same host. The
                    engine key can differ between checks, because sessions are renewed.
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
    </>
  );
}

function CopyButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
