/**
 * Three wisps of air spiralling into a vortex. Each wisp is one spiral path
 * drawn in several layers that share a head position: long and faint at the
 * tail, short and bright at the head, so it tapers like a gust.
 */

const SIZE = 40;
const CENTER = SIZE / 2;

function spiral(rotation: number): string {
  const steps = 72;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = rotation + t * Math.PI * 2 * 1.3;
    const radius = 17 - 11 * Math.pow(t, 0.85);
    const x = CENTER + radius * Math.cos(angle);
    const y = CENTER + radius * Math.sin(angle);
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return points.join("");
}

const WISPS = [0, 1, 2].map((index) => ({
  path: spiral((index * Math.PI * 2) / 3),
  color: `var(--wisp-${index + 1})`,
  delay: `${(-index * 1.7) / 3}s`,
}));

// length (percent of the path), stroke width, opacity
const LAYERS = [
  { length: 52, width: 0.7, opacity: 0.16 },
  { length: 38, width: 1.1, opacity: 0.3 },
  { length: 24, width: 1.6, opacity: 0.55 },
  { length: 12, width: 2.1, opacity: 0.95 },
];

export function ThinkingIndicator({ label = "Thinking…" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-3 text-muted">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        className="thinking-vortex shrink-0"
      >
        <defs>
          <radialGradient id="vortex-core">
            <stop offset="0%" stopColor="var(--wisp-3)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--wisp-3)" stopOpacity="0" />
          </radialGradient>
          <filter id="vortex-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>

        <circle cx={CENTER} cy={CENTER} r="7" fill="url(#vortex-core)" className="vortex-core" />

        <g className="vortex-spin">
          {/* soft glow underneath */}
          <g filter="url(#vortex-glow)" opacity="0.7">
            {WISPS.map((wisp, index) => (
              <path
                key={index}
                d={wisp.path}
                pathLength={100}
                className="vortex-wisp"
                stroke={wisp.color}
                strokeWidth={2.6}
                style={{ "--len": "26px", animationDelay: wisp.delay } as React.CSSProperties}
              />
            ))}
          </g>
          {WISPS.map((wisp, index) =>
            LAYERS.map((layer) => (
              <path
                key={`${index}-${layer.length}`}
                d={wisp.path}
                pathLength={100}
                className="vortex-wisp"
                stroke={wisp.color}
                strokeWidth={layer.width}
                opacity={layer.opacity}
                style={
                  {
                    "--len": `${layer.length}px`,
                    animationDelay: wisp.delay,
                  } as React.CSSProperties
                }
              />
            )),
          )}
          {/* bright tip of each wisp */}
          {WISPS.map((wisp, index) => (
            <path
              key={`tip-${index}`}
              d={wisp.path}
              pathLength={100}
              className="vortex-wisp"
              stroke="var(--wisp-tip)"
              strokeWidth={1.3}
              style={{ "--len": "3px", animationDelay: wisp.delay } as React.CSSProperties}
            />
          ))}
        </g>
      </svg>
      <span className="thinking-text">{label}</span>
    </span>
  );
}
