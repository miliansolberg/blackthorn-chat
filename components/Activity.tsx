"use client";

import { useState } from "react";
import type { ActivityStep } from "@/lib/chats";
import { ThinkingIndicator } from "./ThinkingIndicator";

/**
 * The live record of what happened while a reply was produced: each step the
 * app took, with timings, and the model's own reasoning when a model sends it.
 * While the reply is pending this is the "Thinking…" line; click it to open.
 */
export function Activity({
  steps,
  reasoning,
  pending,
  label,
  seconds,
}: {
  steps?: ActivityStep[];
  reasoning?: string;
  pending: boolean;
  /** What the indicator says while pending. */
  label: string;
  /** Total time taken, once finished. */
  seconds?: number;
}) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(steps) ? steps : [];
  if (!pending && list.length === 0 && !reasoning) return null;

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex items-center gap-1.5 rounded-lg py-1 pr-2 text-muted hover:text-text"
      >
        {pending ? (
          <ThinkingIndicator label={label} />
        ) : (
          <span>
            {typeof seconds === "number" ? `Worked for ${formatSeconds(seconds)}` : "Activity"}
          </span>
        )}
        <svg
          viewBox="0 0 16 16"
          width="11"
          height="11"
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        >
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="mt-1 rounded-xl border border-border px-3 py-2.5">
          {list.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {list.map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="w-12 shrink-0 text-right font-mono text-xs leading-5 text-muted">
                    {formatSeconds(step.at / 1000)}
                  </span>
                  <span className="min-w-0 leading-5 [overflow-wrap:anywhere]">{step.text}</span>
                </li>
              ))}
            </ol>
          )}
          {reasoning ? (
            <div className="mt-2 border-t border-border pt-2">
              <p className="pb-1 text-xs font-medium uppercase tracking-wider text-muted">
                Model reasoning
              </p>
              <p className="whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{reasoning}</p>
            </div>
          ) : (
            <p className="mt-2 border-t border-border pt-2 text-xs text-muted">
              This model does not send its internal reasoning separately, so these are the steps the
              app took. Anything the model reasons through appears in its answer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
