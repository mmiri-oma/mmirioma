/**
 * Flat SVG drawings shared by the landing page: a jerrycan, a keke with its
 * rider, a tanker and the water drop, defined once as `<symbol>`s and drawn
 * with `<use href="#wl-…">`. Inline SVG instead of photos keeps the page
 * light on mobile data.
 */

/** The `<symbol>` definitions. Render once per page, before any `<use>`. */
export function ArtDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="wl-can" viewBox="0 0 28 32">
          <path fillRule="evenodd" d="M7 4.5A2.5 2.5 0 0 1 9.5 2h7A2.5 2.5 0 0 1 19 4.5V9H7zM10 4.6h6V7h-6z" fill="currentColor" />
          <rect x="20" y="4" width="5.5" height="6" rx="1.6" fill="currentColor" />
          <rect x="3" y="8" width="22.5" height="23" rx="3.5" fill="currentColor" />
          <rect x="6.5" y="13" width="15.5" height="13" rx="2" fill="#fff" opacity=".28" />
        </symbol>
        <symbol id="wl-keke" viewBox="0 0 196 124">
          <KekeBody />
          <circle cx="36" cy="106" r="14" fill="#0C2733" />
          <circle cx="36" cy="106" r="6" fill="#DCE6E8" />
          <circle cx="174" cy="106" r="12" fill="#0C2733" />
          <circle cx="174" cy="106" r="5" fill="#DCE6E8" />
          <path d="M160 104q14-16 28 0" fill="none" stroke="#0C2733" strokeWidth="4" strokeLinecap="round" />
        </symbol>
        <symbol id="wl-drop" viewBox="0 0 32 32">
          <path d="M16 2S6 13.5 6 20a10 10 0 0 0 20 0C26 13.5 16 2 16 2Z" fill="#1D8BA6" />
          <path d="M6.3 22c3.2-2.6 6.5-2.6 9.7 0s6.5 2.6 9.7 0A10 10 0 0 1 6.3 22Z" fill="#0C2733" />
          <path d="M11.5 15.5c.6-2 1.6-3.6 2.6-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity=".7" />
        </symbol>
      </defs>
    </svg>
  )
}

/**
 * The keke without its wheels (the hero spins its own wheels). Facing right,
 * in a 196 x 124 box: canopy, blue cargo bay with three yellow jerrycans, the
 * rider in a cap, slanted windscreen and a sun-yellow stripe.
 *
 * @param srcCanClass - Class for the third can, which the hero hides while
 *   that can is "lifted out" to pour.
 */
export function KekeBody({ srcCanClass, word = false }: { srcCanClass?: string; word?: boolean }) {
  return (
    <>
      <path d="M12 18Q14 2 32 2h116q24 0 32 22l1 4H8z" fill="#0C2733" />
      <rect x="4" y="28" width="120" height="70" rx="8" fill="#1D8BA6" />
      <rect x="12" y="33" width="104" height="38" rx="4" fill="#0E3A47" />
      <use href="#wl-can" x="16" y="35" width="30" height="34" color="#F2B33D" />
      <use href="#wl-can" x="50" y="35" width="30" height="34" color="#F2B33D" />
      <use href="#wl-can" className={srcCanClass} x="84" y="35" width="30" height="34" color="#F2B33D" />
      <rect x="4" y="78" width="120" height="6" fill="#F2B33D" />
      {word && (
        <text x="64" y="94" textAnchor="middle" className="wl-keke-word">
          Waterline
        </text>
      )}
      <rect x="130" y="68" width="26" height="8" rx="4" fill="#0C2733" />
      <path d="M138 70q0-18 12-20h4q8 2 10 12l2 8z" fill="#0E4A5A" />
      <circle cx="151" cy="40" r="7.5" fill="#5A3A22" />
      <path d="M143 37q1-9 9-9q7 0 8 7z" fill="#F2B33D" />
      <path d="M156 35.5h8" stroke="#F2B33D" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M157 57l10 4" stroke="#5A3A22" strokeWidth="4" strokeLinecap="round" />
      <path d="M150 72h24q14 0 18 16l1 8h-43z" fill="#1D8BA6" />
      <path d="M170 28h11q8 18 11 44h-14q-2-26-8-44z" fill="#CDEFF2" opacity=".85" />
      <path d="M165 63l7-5" stroke="#0C2733" strokeWidth="3" strokeLinecap="round" />
      <rect x="8" y="94" width="186" height="6" rx="3" fill="#0C2733" />
      <circle cx="188" cy="83" r="3.5" fill="#F2B33D" />
    </>
  )
}

/** A wheel that the hero and the tanker spin: dark tyre, light hub and a cross so turning shows. */
export function Wheel({ x, y, r }: { x: number; y: number; r: number }) {
  const hub = Math.round(r * 0.42)
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="wl-wheel">
        <circle r={r} fill="#0C2733" />
        <circle r={hub} fill="#DCE6E8" />
        <path d={`M-${hub} 0h${hub * 2}M0-${hub}v${hub * 2}`} stroke="#0C2733" strokeWidth="2" />
      </g>
    </g>
  )
}

/** Small stroke icons used across the page (24 x 24, `currentColor`). */
export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6.6 3.5h2.6l1.5 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DropIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <use href="#wl-drop" />
    </svg>
  )
}

export function KekeIcon() {
  return (
    <svg viewBox="0 0 196 124" style={{ width: 28, height: 18 }} aria-hidden="true" focusable="false">
      <use href="#wl-keke" />
    </svg>
  )
}

/**
 * A white tanker with the Waterline name on a dashed road. Inside an element
 * with `wl-play` it drives in (waterline.css). Pass `label=""` when it is decoration.
 */
export function TankerArt({ label = 'A Waterline water tanker' }: { label?: string }) {
  return (
    <svg viewBox="0 0 460 210" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <defs>
        <clipPath id="wl-clip-barrel">
          <rect x="24" y="44" width="276" height="104" rx="52" />
        </clipPath>
      </defs>
      <path className="wl-road-dash" d="M-40 200H520" stroke="#DDD3C2" strokeWidth="4" strokeDasharray="26 18" />
      <g className="wl-truck">
        <ellipse cx="226" cy="190" rx="206" ry="6" fill="#0C2733" opacity=".08" />
        <rect x="22" y="144" width="402" height="16" rx="4" fill="#0C2733" />
        <rect x="24" y="44" width="276" height="104" rx="52" fill="#FFFFFF" />
        <g clipPath="url(#wl-clip-barrel)">
          <rect x="20" y="118" width="290" height="10" fill="#1D8BA6" />
          <rect x="20" y="132" width="290" height="4" fill="#F2B33D" />
          <rect x="250" y="40" width="60" height="120" fill="#EEF2F3" />
        </g>
        <rect x="24" y="44" width="276" height="104" rx="52" fill="none" stroke="#0C2733" strokeOpacity=".14" strokeWidth="2" />
        <rect x="92" y="35" width="32" height="10" rx="3" fill="#0E4A5A" />
        <rect x="196" y="35" width="32" height="10" rx="3" fill="#0E4A5A" />
        <text x="160" y="102" textAnchor="middle" className="wl-truck-word">
          Water<tspan>line</tspan>
        </text>
        <rect x="8" y="118" width="18" height="20" rx="3" fill="#0E4A5A" />
        <path d="M308 62h64q20 0 30 22l18 36q4 8 4 16v14H308z" fill="#1D8BA6" />
        <path d="M320 74h48q12 0 18 14l12 24h-78z" fill="#CDEFF2" />
        <rect x="308" y="124" width="116" height="6" fill="#F2B33D" />
        <rect x="414" y="136" width="16" height="14" rx="3" fill="#0C2733" />
        <circle cx="420" cy="127" r="4" fill="#F2B33D" />
        <Wheel x={80} y={166} r={22} />
        <Wheel x={136} y={166} r={22} />
        <Wheel x={370} y={166} r={22} />
      </g>
    </svg>
  )
}
