"use client";

/**
 * Login mascot. Original artwork — a graduation-cap character that:
 *   · tracks the caret across the ID field with its eyes
 *   · raises both hands over its eyes while a password is being typed
 *   · peeks through its fingers when the password is revealed
 *
 * Everything is CSS-transitioned from three props, so there is no animation
 * loop and it costs nothing when idle.
 */
export function Mascot({
  look = 0.5,
  covering = false,
  peeking = false,
  celebrating = false,
}: {
  /** 0 = far left of the field, 1 = far right. */
  look?: number;
  covering?: boolean;
  peeking?: boolean;
  celebrating?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, look));
  const pupilX = (clamped - 0.5) * 9;
  const guarding = covering || peeking;
  const pupilY = guarding ? 0 : 1.5;
  // Hands are up for both states; peeking just opens a gap to look through.
  const handsY = guarding ? 0 : 64;

  return (
    <svg
      viewBox="0 0 200 150"
      className="h-32 w-full select-none"
      role="img"
      aria-label={
        covering ? "Mascot covering its eyes" : "Mascot watching the sign-in form"
      }
    >
      <defs>
        <linearGradient id="mascot-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
        <clipPath id="mascot-clip">
          <rect x="0" y="0" width="200" height="150" />
        </clipPath>
      </defs>

      <g clipPath="url(#mascot-clip)">
        {/* ears */}
        <circle cx="52" cy="92" r="11" fill="#818cf8" />
        <circle cx="148" cy="92" r="11" fill="#818cf8" />

        {/* head */}
        <circle cx="100" cy="92" r="46" fill="url(#mascot-face)" />

        {/* mortarboard */}
        <g transform={celebrating ? "translate(0,-8) rotate(-6 100 56)" : ""} style={{ transition: "transform .35s cubic-bezier(.34,1.56,.64,1)" }}>
          <path d="M100 30 L156 52 L100 74 L44 52 Z" fill="#1e293b" />
          <path d="M132 62 v18 a4 4 0 0 1 -8 0 v-14" stroke="#facc15" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="128" cy="84" r="4" fill="#facc15" />
        </g>

        {/* eyes */}
        <g>
          <circle cx="84" cy="94" r="10" fill="#ffffff" />
          <circle cx="116" cy="94" r="10" fill="#ffffff" />
          <g
            style={{
              transform: `translate(${pupilX}px, ${pupilY}px)`,
              transition: "transform .18s ease-out",
            }}
          >
            <circle cx="84" cy="94" r="4.6" fill="#1e293b" />
            <circle cx="116" cy="94" r="4.6" fill="#1e293b" />
            <circle cx="85.6" cy="92.2" r="1.5" fill="#ffffff" />
            <circle cx="117.6" cy="92.2" r="1.5" fill="#ffffff" />
          </g>
        </g>

        {/* cheeks + mouth */}
        <circle cx="70" cy="108" r="6" fill="#f9a8d4" opacity="0.55" />
        <circle cx="130" cy="108" r="6" fill="#f9a8d4" opacity="0.55" />
        <path
          d={celebrating ? "M88 112 q12 12 24 0" : "M90 111 q10 8 20 0"}
          stroke="#1e293b"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          style={{ transition: "d .2s ease" }}
        />

        {/* hands — rise to cover the eyes while typing a password */}
        <g
          style={{
            transform: `translateY(${handsY}px)`,
            transition: "transform .28s cubic-bezier(.34,1.4,.64,1)",
          }}
        >
          <g>
            <ellipse cx="76" cy="96" rx="20" ry="17" fill="#6366f1" />
            <ellipse cx="124" cy="96" rx="20" ry="17" fill="#6366f1" />
            {/* fingers */}
            <path d="M62 90 h28 M62 97 h28 M62 104 h28" stroke="#4f46e5" strokeWidth="1.5" opacity="0.5" />
            <path d="M110 90 h28 M110 97 h28 M110 104 h28" stroke="#4f46e5" strokeWidth="1.5" opacity="0.5" />
            {/* the gap the mascot peeks through */}
            <rect
              x="66"
              y="92"
              width="20"
              height="7"
              rx="3.5"
              fill="#ffffff"
              opacity={peeking ? 1 : 0}
              style={{ transition: "opacity .2s ease" }}
            />
            <circle
              cx="78"
              cy="95.5"
              r="3"
              fill="#1e293b"
              opacity={peeking ? 1 : 0}
              style={{ transition: "opacity .2s ease" }}
            />
          </g>
        </g>
      </g>
    </svg>
  );
}
