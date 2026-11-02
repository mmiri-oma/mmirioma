import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../../../lib/analytics'
import { cx } from '../../../lib/cx'
import { ORDER_CTA } from '../content'
import { ArrowIcon } from './Art'
import { drumsLabel } from './logic'

type Mode = 'keke' | 'tanker'
type Tank = 'overhead' | 'ground'

/** Keke choices, as the app offers them (`c-keke`): can size in litres, and how many cans ("gallons"). */
const CAN_SIZES = [25, 50] as const
const CAN_COUNTS = [12, 24, 30, 60] as const
/** Tanker sizes in gallons, as the app offers them (`c-tanker`, decision 11 of handoff v1). */
const TANKER_GALLONS = [500, 750, 1000] as const
/** The drawn tank holds this many gallons; levels are shown against it. */
const TANK_GALLONS = 1000
const fmt = (n: number) => n.toLocaleString('en-NG')

/** Ripple surface for the tank water: one hump up and one down every 80 units, wide enough to slide. */
function wavePath(top: number, amp: number, len = 80, x0 = -240, x1 = 620): string {
  let d = `M${x0} ${top}`
  for (let x = x0; x < x1; x += len) d += ` q${len / 4} ${-amp} ${len / 2} 0 t${len / 2} 0`
  return `${d} V${top + 400} H${x0} Z`
}

/** Counts from the previous number to `target` over 0.7 s, so a change is easy to notice. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = from.current
    if (start === target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = target
      setShown(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700)
      const value = Math.round(start + (target - start) * (1 - Math.pow(1 - k, 3)))
      from.current = value
      setShown(value)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return shown
}

/**
 * "Pick the size that fits": a preview of the app's keke and tanker choices.
 * Keke shows the cans filling up and the litres; tanker shows a tank filling
 * to the chosen gallons. It shows quantities only, never a price: the price
 * comes from the server once the customer has entered an address (FR-022,
 * FR-023), so the button goes on to the real order.
 */
export function SizePicker() {
  const [mode, setMode] = useState<Mode>('keke')
  const [canSize, setCanSize] = useState<(typeof CAN_SIZES)[number]>(25)
  const [count, setCount] = useState<(typeof CAN_COUNTS)[number]>(12)
  const [tank, setTank] = useState<Tank>('overhead')
  const [gallonsChoice, setGallonsChoice] = useState<number | 'custom'>(1000)
  const [custom, setCustom] = useState(1500)
  // Empty until seen, so the cans and the water fill up in front of the visitor.
  const [seen, setSeen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setSeen(true)
        io.disconnect()
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const litres = canSize * count
  const gallons = gallonsChoice === 'custom' ? Math.max(100, Math.round(custom) || 0) : gallonsChoice
  const level = seen ? Math.min(1, gallons / TANK_GALLONS) : 0
  const shown = useCountUp(mode === 'keke' ? litres : gallons)

  function choose(next: Mode, focus = false) {
    setMode(next)
    track('size_picker_mode', { mode: next })
    if (focus) document.getElementById(`wl-tab-${next}`)?.focus()
  }
  function onTabKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    choose(mode === 'keke' ? 'tanker' : 'keke', true)
  }

  const tankNote =
    gallonsChoice !== 'custom'
      ? 'Shown in a 1,000-gallon tank'
      : gallons > TANK_GALLONS
        ? 'More than the 1,000-gallon tank shown. Our team confirms availability and price first.'
        : 'Custom size. Our team confirms availability and price first.'

  return (
    <div className="wl-builder" ref={rootRef}>
      <div className="wl-builder-controls">
        <div className="wl-seg" role="tablist" aria-label="Delivery type" data-active={mode}>
          <span className="wl-seg-pill" aria-hidden="true" />
          {(['keke', 'tanker'] as const).map((m) => (
            <button
              key={m}
              id={`wl-tab-${m}`}
              role="tab"
              type="button"
              aria-selected={mode === m}
              aria-controls={`wl-panel-${m}`}
              tabIndex={mode === m ? 0 : -1}
              onClick={() => mode !== m && choose(m)}
              onKeyDown={onTabKey}
            >
              {m === 'keke' ? 'Keke' : 'Tanker'}
            </button>
          ))}
        </div>

        {mode === 'keke' ? (
          <div id="wl-panel-keke" role="tabpanel" aria-labelledby="wl-tab-keke">
            <fieldset className="wl-fieldset">
              <legend>Can size</legend>
              <div className="wl-chips">
                {CAN_SIZES.map((s) => (
                  <label key={s} className="wl-pick">
                    <input type="radio" name="wl-can" checked={canSize === s} onChange={() => setCanSize(s)} />
                    <span>{s} litres</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="wl-fieldset">
              <legend>
                How many gallons <small>1 gallon = 1 can</small>
              </legend>
              <div className="wl-chips">
                {CAN_COUNTS.map((c) => (
                  <label key={c} className="wl-pick">
                    <input type="radio" name="wl-count" checked={count === c} onChange={() => setCount(c)} />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        ) : (
          <div id="wl-panel-tanker" role="tabpanel" aria-labelledby="wl-tab-tanker">
            <fieldset className="wl-fieldset">
              <legend>Tank type</legend>
              <div className="wl-chips">
                {(['overhead', 'ground'] as const).map((t) => (
                  <label key={t} className="wl-pick">
                    <input type="radio" name="wl-tank" checked={tank === t} onChange={() => setTank(t)} />
                    <span>{t === 'overhead' ? 'Overhead tank' : 'Ground tank'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="wl-fieldset">
              <legend>
                Tanker size <small>in gallons</small>
              </legend>
              <div className="wl-chips">
                {[...TANKER_GALLONS, 'custom' as const].map((g) => (
                  <label key={g} className="wl-pick">
                    <input type="radio" name="wl-gallons" checked={gallonsChoice === g} onChange={() => setGallonsChoice(g)} />
                    <span>{g === 'custom' ? 'Custom' : fmt(g)}</span>
                  </label>
                ))}
              </div>
              {gallonsChoice === 'custom' && (
                <div className="wl-custom">
                  <label htmlFor="wl-custom-gallons">How many gallons?</label>
                  <span className="wl-stepper">
                    <button type="button" aria-label="100 gallons less" onClick={() => setCustom((v) => Math.max(100, v - 100))}>
                      −
                    </button>
                    <input
                      id="wl-custom-gallons"
                      type="number"
                      inputMode="numeric"
                      min={100}
                      step={100}
                      value={custom}
                      onChange={(e) => setCustom(Number(e.target.value))}
                    />
                    <button type="button" aria-label="100 gallons more" onClick={() => setCustom((v) => Math.max(100, v + 100))}>
                      +
                    </button>
                  </span>
                </div>
              )}
            </fieldset>
          </div>
        )}

        <div className="wl-summary" aria-live="polite">
          <p className="wl-sum-big">
            <b>{fmt(shown)}</b> <span>{mode === 'keke' ? 'litres' : 'gallons'}</span>
          </p>
          <p className="wl-sum-line">
            {mode === 'keke' ? `${count} gallons × ${canSize} L, poured into your drums.` : `Pumped straight into your ${tank} tank.`}
          </p>
        </div>
        <Link to="/order" className="wl-btn wl-btn-primary wl-btn-block" onClick={() => track('order_cta_click', { location: 'size_picker', mode })}>
          <span>{ORDER_CTA}</span>
          <ArrowIcon />
        </Link>
        <p className="wl-fine">You see the full price in the app before you confirm, and you pay cash after the water is poured.</p>
      </div>

      <div className="wl-stage">
        {mode === 'keke' ? (
          <div>
            <p className="wl-stage-label">Your keke load · {count} gallons</p>
            <div className={cx('wl-can-grid', canSize === 50 && 'wl-big')} aria-hidden="true">
              {Array.from({ length: 60 }, (_, i) => (
                <svg key={i} viewBox="0 0 28 32" className={cx(seen && i < count && 'wl-on')} style={{ transitionDelay: `${i * 10}ms` }}>
                  <use href="#wl-can" />
                </svg>
              ))}
            </div>
            <p className="wl-stage-note">About {drumsLabel(litres)} standard drums (200 L each)</p>
          </div>
        ) : (
          <div>
            <TankDrawing type={tank} level={level} />
            <p className="wl-stage-note">{tankNote}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Geometry of the two drawn tanks: the body outline, where the water surface is when full, and how tall the water can be. */
const TANKS = {
  overhead: {
    body: 'M116 86Q116 54 150 52h60q34 2 34 34v110q0 10-10 10H126q-10 0-10-10z',
    top: 52,
    height: 154,
    ticks: { x: 252, labels: ['250', '500', '750', '1,000'] },
  },
  ground: {
    body: 'M70 200q0-28 34-30h152q34 2 34 30v120q0 10-10 10H80q-10 0-10-10z',
    top: 170,
    height: 160,
    ticks: { x: 298, labels: ['250', '500', '750', '1k'] },
  },
} as const

/**
 * An overhead tank on its stand, or a ground tank on a slab, see-through so
 * the water shows. `level` (0 to 1) of the 1,000-gallon tank is filled, with a
 * moving surface.
 */
function TankDrawing({ type, level }: { type: Tank; level: number }) {
  const t = TANKS[type]
  const bottom = t.top + t.height
  return (
    <svg viewBox="0 0 360 370" className="wl-tank-svg" role="img" aria-label={`${type === 'overhead' ? 'Overhead' : 'Ground'} tank, ${Math.round(level * 100)}% full`}>
      <defs>
        <clipPath id={`wl-clip-${type}`}>
          <path d={t.body} />
        </clipPath>
      </defs>
      <g className="wl-tank wl-on" key={type}>
        {type === 'overhead' ? (
          <>
            <g stroke="#0C2733" strokeLinecap="round">
              <path d="M128 214l-10 136M232 214l10 136" strokeWidth="7" />
              <path d="M124 248l112 46M236 248l-112 46M121 300l118 44M239 300l-118 44" strokeWidth="3.5" opacity=".7" />
            </g>
            <rect x="108" y="206" width="144" height="12" rx="3" fill="#0C2733" />
            <rect x="84" y="350" width="192" height="10" rx="3" fill="#DDD3C2" />
          </>
        ) : (
          <rect x="40" y="330" width="280" height="16" rx="4" fill="#DDD3C2" />
        )}
        <path d={t.body} fill="#E3F1F2" />
        <g clipPath={`url(#wl-clip-${type})`}>
          <g className="wl-water" style={{ transform: `translateY(${(1 - level) * t.height}px)` }}>
            <path className="wl-wave-back" d={wavePath(t.top - 3, 4)} fill="#1D8BA6" />
            <path className="wl-wave-front" d={wavePath(t.top + 3, 5)} fill="#3FB3C8" />
          </g>
          <g stroke="#0C2733" strokeWidth="3" opacity=".08">
            {[0.25, 0.5, 0.75, 1].map((k) => (
              <path key={k} d={`M40 ${bottom - k * t.height + 6}h280`} />
            ))}
          </g>
          <rect x={type === 'overhead' ? 128 : 86} y={t.top + 18} width="9" height={t.height - 32} rx="4.5" fill="#fff" opacity=".35" />
        </g>
        <path d={t.body} fill="none" stroke="#0E4A5A" strokeOpacity=".3" strokeWidth="2" />
        <rect x={type === 'overhead' ? 162 : 160} y={t.top - 12} width={type === 'overhead' ? 36 : 40} height="13" rx="4" fill="#0E4A5A" />
        <g className="wl-ticks" fill="#3D5560">
          {t.ticks.labels.map((label, i) => {
            const y = bottom - ((i + 1) / 4) * t.height
            return (
              <g key={label}>
                <path d={`M${t.ticks.x} ${y}h8`} stroke="#3D5560" strokeWidth="1.5" />
                <text x={t.ticks.x + 12} y={y + 4}>
                  {label}
                </text>
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}
