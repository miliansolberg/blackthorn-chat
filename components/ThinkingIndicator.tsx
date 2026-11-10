/**
 * Three thin concentric arcs. Each makes one slow, eased turn, starting a beat
 * after the one outside it, so they fan apart and fall back into line.
 */

const SIZE = 18;
const CENTER = SIZE / 2;

const ARCS = [
  { radius: 7.6, delay: "0s" },
  { radius: 5, delay: "0.16s" },
  { radius: 2.4, delay: "0.32s" },
];

export function ThinkingIndicator({ label = "Thinking…" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2.5 text-sm text-muted">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        className="shrink-0"
      >
        {ARCS.map((arc) => {
          const circumference = 2 * Math.PI * arc.radius;
          return (
            <circle
              key={arc.radius}
              cx={CENTER}
              cy={CENTER}
              r={arc.radius}
              className="think-arc"
              strokeDasharray={`${(circumference * 0.58).toFixed(2)} ${(circumference * 0.42).toFixed(2)}`}
              style={{ animationDelay: arc.delay }}
            />
          );
        })}
      </svg>
      {label}
    </span>
  );
}
