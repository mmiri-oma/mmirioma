/**
 * Decorative artwork copied from the design handoff SVGs: map pins, map
 * panels, waves and tank drawings. Shapes and colours are exact; do not
 * redraw. All of it is `aria-hidden`; screens describe the state in words.
 *
 * The maps are illustrations, not live maps (no map provider is approved).
 * They show the same picture for every address; the address itself is
 * always written out next to them.
 */
import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { CrosshairIcon } from '../icons/icons'

const PIN_PATH = 'M12 29s-10-9-10-17a10 10 0 0 1 20 0c0 8-10 17-10 17Z'

/** Map pin (24 × 30 viewBox) with a pulsing ring under it (`.ping`). */
export function MapPin({
  color,
  ringColor,
  width = 34,
  height = 42,
  ringSize = 18,
  className,
  style,
}: {
  color: string
  ringColor: string
  width?: number
  height?: number
  ringSize?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <div aria-hidden="true" className={className} style={style}>
      <span
        className="animate-ping absolute bottom-[-6px] left-1/2 rounded-full"
        style={{ width: ringSize, height: ringSize, marginLeft: -ringSize / 2, background: ringColor }}
      />
      <svg width={width} height={height} viewBox="0 0 24 30" className="relative">
        <path d={PIN_PATH} fill={color} />
        <circle cx="12" cy="12" r="4" fill="#fff" />
      </svg>
    </div>
  )
}

/** Dark (or light) label on a map (`.mapbadge`). */
export function MapBadge({
  children,
  tone = 'dark',
  className,
  style,
}: {
  children: ReactNode
  tone?: 'dark' | 'light'
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={cx(
        'mo-mapbadge',
        tone === 'dark' ? 'bg-ink text-white' : 'bg-white text-ink',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

/** Round map control button look (`.ctl`), decorative. */
export function MapControl({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className="absolute right-2.5 flex size-[38px] items-center justify-center rounded-input bg-white text-ink shadow-control"
      style={style}
    >
      <CrosshairIcon size={18} roundJoin={false} />
    </span>
  )
}

/** Map frame (`.map`): rounded, clips its artwork. */
export function MapFrame({ height, className, children }: { height: number; className?: string; children: ReactNode }) {
  return (
    <div className={cx('relative overflow-hidden rounded-stat bg-map', className)} style={{ height }}>
      {children}
    </div>
  )
}

/** Street-map art of the delivery details screen (`c-details`, 354 × 132). */
export function DetailsMapArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 354 132" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="132" width="354" />
      <path d="M-10 96 C 60 80 120 112 190 92 S 300 60 370 74" fill="none" stroke="#BFDDF7" strokeWidth="16" />
      <rect fill="#D3EDD8" height="42" rx="8" width="70" x="236" y="8" />
      <path d="M0 40 H354 M120 0 V132 M0 118 H354 M250 0 V132" stroke="#FFFFFF" strokeWidth="9" />
      <path d="M40 0 L 210 132" stroke="#FBE7A1" strokeWidth="10" />
      <path d="M0 70 H354" stroke="#FFFFFF" strokeWidth="6" />
    </svg>
  )
}

/** Street-map art of the saved-address picker (`c-address-pick`, 354 × 150). */
export function AddressMapArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 354 150" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="150" width="354" />
      <rect fill="#D3EDD8" height="50" rx="10" width="100" x="236" y="10" />
      <path d="M-10 110 C 80 90 140 130 220 106 S 320 80 370 90" fill="none" stroke="#BFDDF7" strokeWidth="16" />
      <path d="M0 50 H354 M110 0 V150 M250 0 V150" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M0 140 L 354 20" stroke="#FBE7A1" strokeWidth="10" />
    </svg>
  )
}

/** Street-map art with the flowing route of the tracking screen (`c-track`, 354 × 268). */
export function TrackMapArt() {
  const route = 'M58 236 L 110 236 L 110 176 L 232 176 L 232 82 L 286 82'
  return (
    <svg aria-hidden="true" viewBox="0 0 354 268" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="268" width="354" />
      <rect fill="#F4F7F9" height="52" rx="8" width="80" x="18" y="14" />
      <rect fill="#F4F7F9" height="52" rx="8" width="110" x="118" y="14" />
      <rect fill="#F4F7F9" height="70" rx="8" width="90" x="248" y="96" />
      <rect fill="#F4F7F9" height="62" rx="8" width="90" x="18" y="190" />
      <rect fill="#D3EDD8" height="64" rx="10" width="92" x="248" y="14" />
      <path d="M-10 150 C 60 128 120 176 190 150 S 300 112 370 126" fill="none" stroke="#BFDDF7" strokeWidth="18" />
      <path d="M0 82 H354 M232 0 V268 M110 0 V268 M0 176 H354" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M0 236 L 354 30" stroke="#FBE7A1" strokeWidth="12" />
      <path d={route} fill="none" opacity=".25" stroke="#0E4A5A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7" />
      <path d={route} fill="none" stroke="#11708C" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
      <circle cx="58" cy="236" fill="#fff" r="7" stroke="#11708C" strokeWidth="4" />
    </svg>
  )
}

/** Short flowing route under the "Order placed" card (`c-confirmed`, 354 × 92). */
export function PlacedRouteArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 354 92" preserveAspectRatio="none" className="absolute inset-0 size-full">
      <path className="route-flow" d="M20 70 C 90 30 160 90 230 50 S 320 30 330 40" fill="none" stroke="#11708C" strokeLinecap="round" strokeWidth="3" />
    </svg>
  )
}

/**
 * Moving wave at the bottom of a header (`.wave`): 780 px wide (two phone
 * widths), slides left by half so it loops seamlessly.
 */
export function Wave({
  fill,
  height = 40,
  variant = 'tall',
  className,
  style,
}: {
  fill: string
  height?: number
  /** `tall` is the 40 px header wave, `low` the 34 px wave on cards. */
  variant?: 'tall' | 'low'
  className?: string
  style?: CSSProperties
}) {
  const d =
    variant === 'tall'
      ? 'M0 22 Q 48.75 8 97.5 22 T 195 22 T 292.5 22 T 390 22 T 487.5 22 T 585 22 T 682.5 22 T 780 22 V40 H0 Z'
      : 'M0 16 Q 48.75 4 97.5 16 T 195 16 T 292.5 16 T 390 16 T 487.5 16 T 585 16 T 682.5 16 T 780 16 V34 H0 Z'
  return (
    <svg
      aria-hidden="true"
      width="780"
      height={height}
      viewBox={variant === 'tall' ? '0 0 780 40' : '0 0 780 34'}
      className={cx('animate-wave absolute left-0 max-w-none', className)}
      style={style}
    >
      <path d={d} fill={fill} />
    </svg>
  )
}

/** Ground tank drawing (`c-tanker`, 64 × 62). */
export function GroundTankArt() {
  return (
    <svg aria-hidden="true" width="64" height="62" viewBox="0 0 64 62">
      <ellipse cx="32" cy="52" fill="#D6E2EE" rx="24" ry="5" />
      <rect fill="#2F3A48" height="40" rx="8" width="44" x="10" y="12" />
      <ellipse cx="32" cy="12" fill="#47566A" rx="22" ry="6" />
      <rect fill="#47566A" height="3" width="44" x="10" y="22" />
      <rect fill="#47566A" height="3" width="44" x="10" y="34" />
      <rect fill="#11708C" height="6" rx="2" width="12" x="26" y="4" />
    </svg>
  )
}

/** Overhead tank on a stand (`c-tanker`, 64 × 62). */
export function OverheadTankArt() {
  return (
    <svg aria-hidden="true" width="64" height="62" viewBox="0 0 64 62">
      <rect fill="#2F3A48" height="26" rx="6" width="32" x="16" y="4" />
      <ellipse cx="32" cy="4" fill="#47566A" rx="16" ry="4" />
      <rect fill="#47566A" height="2.5" width="32" x="16" y="13" />
      <path d="M18 30 L12 60 M46 30 L52 60 M15 44 H49 M18 30 L49 44 M46 30 L15 44" fill="none" stroke="#56677D" strokeWidth="2.4" />
    </svg>
  )
}

/** Falling confetti pieces (`.cf`) at given positions and delays. */
export function Confetti({ pieces, height }: { pieces: { left: number; top: number; color: string; delay: number }[]; height: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{ left: `${(p.left / 390) * 100}%`, top: p.top, background: p.color, animationDelay: `${p.delay}s` }}
        />
      ))}
    </div>
  )
}

/** Map to the refill station (`r-refill`, 354 × 400). */
export function RefillMapArt() {
  const route = 'M80 360 L 160 360 L 160 246 L 160 120 L 248 120 L 248 92'
  return (
    <svg aria-hidden="true" viewBox="0 0 354 400" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="400" width="354" />
      <rect fill="#F4F7F9" height="80" rx="10" width="90" x="20" y="20" />
      <rect fill="#F4F7F9" height="90" rx="10" width="130" x="200" y="140" />
      <rect fill="#F4F7F9" height="110" rx="10" width="120" x="20" y="260" />
      <rect fill="#D3EDD8" height="90" rx="12" width="130" x="200" y="20" />
      <path d="M-10 230 C 80 200 140 260 220 236 S 320 196 370 210" fill="none" stroke="#BFDDF7" strokeWidth="20" />
      <path d="M0 120 H354 M160 0 V400 M0 246 H354 M0 380 H354" stroke="#FFFFFF" strokeWidth="12" />
      <path d="M0 330 L 354 70" stroke="#FBE7A1" strokeWidth="14" />
      {/* No place names: they would read as where the job is (#157). The screen names the real place. */}
      <path d={route} fill="none" opacity=".22" stroke="#0E4A5A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="9" />
      <path d={route} className="route-flow" fill="none" stroke="#11708C" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
    </svg>
  )
}

/** Map to the customer (`r-customer`, 354 × 330). */
export function CustomerMapArt() {
  const route = 'M40 280 L 160 280 L 160 150 L 268 150 L 268 96'
  return (
    <svg aria-hidden="true" viewBox="0 0 354 330" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="330" width="354" />
      <rect fill="#F4F7F9" height="70" rx="10" width="110" x="20" y="20" />
      <rect fill="#F4F7F9" height="100" rx="10" width="140" x="190" y="200" />
      <rect fill="#F4F7F9" height="100" rx="10" width="110" x="20" y="200" />
      <rect fill="#D3EDD8" height="90" rx="12" width="140" x="190" y="20" />
      <path d="M0 150 H354 M160 0 V330" stroke="#FFFFFF" strokeWidth="14" />
      <path d="M0 110 L 354 260" stroke="#FBE7A1" strokeWidth="12" />
      <path d="M-10 186 C 60 170 120 200 200 180 S 300 160 370 170" fill="none" stroke="#BFDDF7" strokeWidth="16" />
      <path d={route} fill="none" opacity=".22" stroke="#0E4A5A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="9" />
      <path d={route} className="route-flow" fill="none" stroke="#11708C" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
    </svg>
  )
}

/** Full-screen map to the refill station for tanker drivers (`t-refill`, 390 × 844). */
export function TankerRefillMapArt() {
  const route = 'M110 640 L 190 640 L 190 260 L 300 260 L 300 236'
  return (
    <svg aria-hidden="true" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="844" width="390" />
      <rect fill="#F4F7F9" height="110" rx="12" width="120" x="24" y="120" />
      <rect fill="#F4F7F9" height="120" rx="12" width="150" x="220" y="300" />
      <rect fill="#F4F7F9" height="140" rx="12" width="130" x="24" y="460" />
      <rect fill="#D3EDD8" height="120" rx="14" width="150" x="220" y="110" />
      <path d="M-10 440 C 90 400 170 480 260 440 S 360 400 400 420" fill="none" stroke="#BFDDF7" strokeWidth="22" />
      <path d="M0 260 H390 M190 0 V844 M0 640 H390" stroke="#FFFFFF" strokeWidth="14" />
      <path d="M0 720 L 390 200" stroke="#FBE7A1" strokeWidth="16" />
      <path d={route} fill="none" opacity=".22" stroke="#15803D" strokeLinecap="round" strokeLinejoin="round" strokeWidth="10" />
      <path d={route} className="route-flow" fill="none" stroke="#16A34A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
    </svg>
  )
}

/** Map to the customer for tanker drivers (`t-customer`, 354 × 330). */
export function TankerCustomerMapArt() {
  const route = 'M40 300 L 170 300 L 170 130 L 280 130 L 280 96'
  return (
    <svg aria-hidden="true" viewBox="0 0 354 330" preserveAspectRatio="xMidYMid slice" className="block size-full">
      <rect fill="#E9EEF2" height="330" width="354" />
      <rect fill="#F4F7F9" height="80" rx="10" width="120" x="20" y="20" />
      <rect fill="#F4F7F9" height="110" rx="10" width="134" x="200" y="190" />
      <rect fill="#D3EDD8" height="90" rx="12" width="134" x="200" y="20" />
      <path d="M-10 160 C 70 140 140 180 210 160 S 310 140 370 150" fill="none" stroke="#BFDDF7" strokeWidth="16" />
      <path d="M0 130 H354 M170 0 V330 M0 250 H354" stroke="#FFFFFF" strokeWidth="13" />
      <path d="M0 320 L 354 60" stroke="#FBE7A1" strokeWidth="12" />
      <path d={route} fill="none" opacity=".22" stroke="#15803D" strokeLinecap="round" strokeLinejoin="round" strokeWidth="9" />
      <path d={route} className="route-flow" fill="none" stroke="#16A34A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
    </svg>
  )
}

/**
 * The tank gauge on `t-loading` (110 × 150): water level with a wave on top
 * and a dashed target line. The water block slides up with `translateY`
 * (the design animated `height`; a transform keeps the wave undistorted and
 * the animation on the compositor). Reduced motion turns the transition off.
 */
export function TankGauge({ fraction, target, targetLabel }: { fraction: number; target: number; targetLabel: string }) {
  const level = Math.max(0, Math.min(1, fraction))
  return (
    <div aria-hidden="true" className="relative h-[150px] w-[110px] shrink-0 overflow-hidden rounded-[22px] border-4 border-solid border-ink bg-[#F4F9FF]">
      <div
        className="absolute inset-0 transition-transform duration-[600ms] ease-[cubic-bezier(.2,.8,.2,1)]"
        style={{ transform: `translateY(${(1 - level) * 100}%)` }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#26C0C1,#11708C)]" />
        <svg width="220" height="14" viewBox="0 0 220 14" className="animate-wave absolute top-[-12px] left-0 max-w-none">
          <path d="M0 8 Q 13.75 0 27.5 8 T 55 8 T 82.5 8 T 110 8 T 137.5 8 T 165 8 T 192.5 8 T 220 8 V14 H0 Z" fill="#26C0C1" />
        </svg>
      </div>
      <div className="absolute right-0 left-0 border-t-2 border-dashed border-[#DC2626]" style={{ top: `${(1 - target) * 100}%` }} />
      <span className="absolute right-1 text-[10px] font-extrabold text-[#B91C1C]" style={{ top: `calc(${(1 - target) * 100}% - 18px)` }}>
        {targetLabel}
      </span>
    </div>
  )
}
