/** Logo variants: the drop mark with the wordmark beside it or under it, or the mark alone; `-dark` for dark backgrounds. */
export type LogoVariant = 'horizontal' | 'horizontal-dark' | 'mark' | 'mark-dark' | 'stacked' | 'stacked-dark'

interface LogoProps {
  variant?: LogoVariant
  /** Rendered height in px. The design uses about 30 on phones and 34 to 48 on desktop. */
  height?: number
  /** Accessible name. Pass an empty string when the logo is decorative. */
  alt?: string
  className?: string
}

/** The SVG box of each layout; the width follows from the height through it. */
const VIEWBOX: Record<'horizontal' | 'mark' | 'stacked', { w: number; h: number }> = {
  horizontal: { w: 196, h: 44 },
  mark: { w: 32, h: 32 },
  stacked: { w: 150, h: 104 },
}

/** Colours on light and dark backgrounds (Waterline theme tokens). */
const TONES = {
  light: { water: '#1D8BA6', base: '#0C2733', word: '#0C2733', line: '#1D8BA6' },
  dark: { water: '#1D8BA6', base: '#5CC6D4', word: '#FFFFFF', line: '#5CC6D4' },
}

/**
 * The drop: a water drop whose lower part is filled up to a wavy line, the
 * "waterline" the name comes from. Drawn in a 32 x 32 box at (x, y).
 */
function Drop({ x = 0, y = 0, size = 32, tone }: { x?: number; y?: number; size?: number; tone: (typeof TONES)['light'] }) {
  const s = size / 32
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M16 2S6 13.5 6 20a10 10 0 0 0 20 0C26 13.5 16 2 16 2Z" fill={tone.water} />
      <path d="M6.3 22c3.2-2.6 6.5-2.6 9.7 0s6.5 2.6 9.7 0A10 10 0 0 1 6.3 22Z" fill={tone.base} />
      <path d="M11.5 15.5c.6-2 1.6-3.6 2.6-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity=".7" />
    </g>
  )
}

/** "Water" upright and "line" in italic: Fraunces, the display face of the theme. */
function Wordmark({ x, y, size, anchor = 'start', tone }: { x: number; y: number; size: number; anchor?: 'start' | 'middle'; tone: (typeof TONES)['light'] }) {
  return (
    <text x={x} y={y} fontSize={size} textAnchor={anchor} fontFamily="Fraunces, Georgia, serif" fontWeight={620} letterSpacing="-0.4" fill={tone.word}>
      Water
      <tspan fontStyle="italic" fontWeight={500} fill={tone.line}>
        line
      </tspan>
    </text>
  )
}

/**
 * The Waterline logo, drawn as SVG so it stays sharp at any size and costs
 * no image download on slow connections. Use this component wherever the
 * logo appears; do not draw it again elsewhere.
 */
export function Logo({ variant = 'horizontal', height = 30, alt = 'Waterline', className }: LogoProps) {
  const dark = variant.endsWith('-dark')
  const layout = variant.replace('-dark', '') as keyof typeof VIEWBOX
  const box = VIEWBOX[layout]
  const tone = dark ? TONES.dark : TONES.light
  const width = Math.round((height * box.w) / box.h)
  const label = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true }
  return (
    <svg
      {...label}
      viewBox={`0 0 ${box.w} ${box.h}`}
      width={width}
      height={height}
      className={className}
      style={{ height, width: 'auto', display: 'block', overflow: 'visible' }}
    >
      {layout === 'horizontal' && (
        <>
          <Drop x={0} y={4} size={36} tone={tone} />
          <Wordmark x={44} y={32} size={30} tone={tone} />
        </>
      )}
      {layout === 'mark' && <Drop tone={tone} />}
      {layout === 'stacked' && (
        <>
          <Drop x={51} y={0} size={48} tone={tone} />
          <Wordmark x={75} y={92} size={34} anchor="middle" tone={tone} />
        </>
      )}
    </svg>
  )
}
