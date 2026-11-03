import type { CSSProperties, ReactNode } from 'react'

/**
 * The Waterline flat drawings for the app screens: a jerrycan, a keke with
 * its rider and a tanker. Self-contained SVG (no shared `<symbol>`), so any
 * screen can use them, and light on data compared with the old photo-style
 * images. `Illustration` uses these for `keke`, `tanker` and `jerrycan`.
 */

interface ArtProps {
  className?: string
  style?: CSSProperties
  /** Accessible description; empty marks the drawing as decoration. */
  label?: string
}

function Svg({ viewBox, className, style, label, children }: ArtProps & { viewBox: string; children: ReactNode }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg {...a11y} viewBox={viewBox} className={className} style={{ overflow: 'visible', ...style }} focusable="false">
      {children}
    </svg>
  )
}

/** One jerrycan, drawn in a 28 × 32 box at (x, y) and scaled to (w, h). */
function Can({ x = 0, y = 0, w = 28, h = 32, color = '#F2B33D' }: { x?: number; y?: number; w?: number; h?: number; color?: string }) {
  return (
    <svg x={x} y={y} width={w} height={h} viewBox="0 0 28 32">
      <path fillRule="evenodd" d="M7 4.5A2.5 2.5 0 0 1 9.5 2h7A2.5 2.5 0 0 1 19 4.5V9H7zM10 4.6h6V7h-6z" fill={color} />
      <rect x="20" y="4" width="5.5" height="6" rx="1.6" fill={color} />
      <rect x="3" y="8" width="22.5" height="23" rx="3.5" fill={color} />
      <rect x="6.5" y="13" width="15.5" height="13" rx="2" fill="#fff" opacity=".28" />
    </svg>
  )
}

/** A 25 L jerrycan. */
export function FlatJerrycan(props: ArtProps) {
  return (
    <Svg viewBox="0 0 28 32" {...props}>
      <Can color="#1D8BA6" />
    </Svg>
  )
}

/** A keke carrying three jerrycans, with its rider, facing right. */
export function FlatKeke(props: ArtProps) {
  return (
    <Svg viewBox="0 0 196 124" {...props}>
      <path d="M12 18Q14 2 32 2h116q24 0 32 22l1 4H8z" fill="#0C2733" />
      <rect x="4" y="28" width="120" height="70" rx="8" fill="#1D8BA6" />
      <rect x="12" y="33" width="104" height="38" rx="4" fill="#0E3A47" />
      <Can x={16} y={35} w={30} h={34} />
      <Can x={50} y={35} w={30} h={34} />
      <Can x={84} y={35} w={30} h={34} />
      <rect x="4" y="78" width="120" height="6" fill="#F2B33D" />
      <rect x="130" y="68" width="26" height="8" rx="4" fill="#0C2733" />
      <path d="M138 70q0-18 12-20h4q8 2 10 12l2 8z" fill="#0E4A5A" />
      <circle cx="151" cy="40" r="7.5" fill="#5A3A22" />
      <path d="M143 37q1-9 9-9q7 0 8 7z" fill="#F2B33D" />
      <path d="M157 57l10 4" stroke="#5A3A22" strokeWidth="4" strokeLinecap="round" />
      <path d="M150 72h24q14 0 18 16l1 8h-43z" fill="#1D8BA6" />
      <path d="M170 28h11q8 18 11 44h-14q-2-26-8-44z" fill="#CDEFF2" opacity=".85" />
      <rect x="8" y="94" width="186" height="6" rx="3" fill="#0C2733" />
      <circle cx="188" cy="83" r="3.5" fill="#F2B33D" />
      <circle cx="36" cy="106" r="14" fill="#0C2733" />
      <circle cx="36" cy="106" r="6" fill="#DCE6E8" />
      <circle cx="174" cy="106" r="12" fill="#0C2733" />
      <circle cx="174" cy="106" r="5" fill="#DCE6E8" />
      <path d="M160 104q14-16 28 0" fill="none" stroke="#0C2733" strokeWidth="4" strokeLinecap="round" />
    </Svg>
  )
}

/** A white tanker with the Waterline name, facing right. */
export function FlatTanker(props: ArtProps) {
  return (
    <Svg viewBox="0 0 440 196" {...props}>
      <rect x="12" y="140" width="412" height="16" rx="4" fill="#0C2733" />
      <rect x="14" y="40" width="276" height="104" rx="52" fill="#FFFFFF" />
      <rect x="44" y="114" width="216" height="10" fill="#1D8BA6" />
      <rect x="44" y="128" width="216" height="4" fill="#F2B33D" />
      <rect x="14" y="40" width="276" height="104" rx="52" fill="none" stroke="#0C2733" strokeOpacity=".16" strokeWidth="2" />
      <rect x="82" y="31" width="32" height="10" rx="3" fill="#0E4A5A" />
      <rect x="186" y="31" width="32" height="10" rx="3" fill="#0E4A5A" />
      <text x="150" y="98" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="30" fontWeight="600" fill="#0C2733">
        Water
        <tspan fill="#1D8BA6" fontStyle="italic">
          line
        </tspan>
      </text>
      <path d="M298 58h64q20 0 30 22l18 36q4 8 4 16v14H298z" fill="#1D8BA6" />
      <path d="M310 70h48q12 0 18 14l12 24h-78z" fill="#CDEFF2" />
      <rect x="298" y="120" width="116" height="6" fill="#F2B33D" />
      {[70, 126, 360].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="162" r="22" fill="#0C2733" />
          <circle cx={cx} cy="162" r="9" fill="#DCE6E8" />
        </g>
      ))}
    </Svg>
  )
}
