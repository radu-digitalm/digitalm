type SignatureProps = {
  className?: string;
  /** When true (default), the node travels the arc (motion-path); when false it sits static at the apex. */
  pulse?: boolean;
};

/**
 * The Digital M signature element: a "signal node on a track".
 * The detached dot from the logo becomes a node (the AI signal) riding a
 * precise arc (the systems we engineer). Reused as a hero motif and marker.
 */
export function Signature({ className, pulse = true }: SignatureProps) {
  const ARC = "M64 26 C 150 70, 150 180, 64 224";
  return (
    <svg
      viewBox="0 0 200 250"
      className={className}
      role="img"
      aria-label="Digital M signal mark"
    >
      <defs>
        <linearGradient id="dm-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#F15A24" />
          <stop offset="0.52" stopColor="#EE355E" />
          <stop offset="1" stopColor="#ED1E79" />
        </linearGradient>
      </defs>

      {/* faint full track */}
      <path d={ARC} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      {/* gradient signal arc */}
      <path
        d={ARC}
        fill="none"
        stroke="url(#dm-grad)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0.5 16"
      />
      {/* precision ticks */}
      <line x1="112" y1="58" x2="121" y2="62" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <line x1="131" y1="125" x2="140" y2="125" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <line x1="112" y1="192" x2="121" y2="188" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />

      {/* echo dot — the logo's detached dot, always static */}
      <circle cx="64" cy="125" r="9" fill="url(#dm-grad)" />

      {pulse ? (
        <g
          className="node-travel"
          style={{
            offsetPath: `path('${ARC}')`,
            offsetDistance: "50%",
            willChange: "offset-distance",
          }}
        >
          <circle cx="0" cy="0" r="18" fill="url(#dm-grad)" opacity="0.18" />
          <circle cx="0" cy="0" r="7.5" fill="url(#dm-grad)" />
        </g>
      ) : (
        <>
          <circle cx="130" cy="125" r="18" fill="url(#dm-grad)" opacity="0.16" />
          <circle cx="130" cy="125" r="7.5" fill="url(#dm-grad)" />
        </>
      )}
    </svg>
  );
}
