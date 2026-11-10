import { useId } from "react";

/**
 * How much of the model's context window this chat has used: a small circle
 * that fills from the bottom as the window fills, with the share still left.
 */
export function ContextRing({ used, window }: { used: number; window: number | null }) {
  const clipId = useId();
  if (!window) return null;

  const usedShare = Math.min(1, Math.max(0, used / window));
  const left = Math.round((1 - usedShare) * 100);
  const size = 16;
  const radius = 6.6;
  // Height of the filled part, measured up from the bottom of the circle.
  const level = usedShare * radius * 2;

  return (
    <span
      title={`${used.toLocaleString()} of ${window.toLocaleString()} tokens used in this chat (${left}% of the context window left)`}
      className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted"
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <circle cx={size / 2} cy={size / 2} r={radius} />
          </clipPath>
        </defs>
        <rect
          x="0"
          y={size / 2 + radius - level}
          width={size}
          height={level}
          fill="var(--spinner)"
          clipPath={`url(#${clipId})`}
          style={{ transition: "y 0.4s ease, height 0.4s ease" }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--spinner)"
          strokeWidth="1.3"
        />
      </svg>
      <span aria-label={`${left}% of the context window left`}>{left}%</span>
    </span>
  );
}
