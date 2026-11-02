import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '../../../lib/cx'
import { CheckIcon, DropIcon, KekeBody, KekeIcon, Wheel } from './Art'

/** The status card's three moments, timed to the CSS sequence in waterline.css. */
const STEPS: { at: number; icon: ReactNode; title: string; sub: string }[] = [
  { at: 0, icon: <KekeIcon />, title: 'Keke on the way', sub: '12 gallons × 25 L' },
  { at: 2700, icon: <DropIcon />, title: 'Pouring into your drums', sub: 'Your rider is at the gate' },
  { at: 8700, icon: <CheckIcon />, title: 'Code given. Delivered.', sub: 'All 300 litres poured in' },
]
/** When the replay button appears: just after the last step. */
const DONE_AT = 9400

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * The hero picture: a keke drives up to a compound gate in Enugu, lifts a
 * jerrycan and pours it into two drums, and the status card says what is
 * happening ("on the way", "pouring", "delivered"). It is an illustration of
 * how a delivery works, not live data.
 *
 * The sequence starts the first time half of the picture is on screen (on a
 * phone it sits below the fold), can be replayed, and jumps straight to the
 * end when the visitor prefers reduced motion.
 */
export function HeroScene() {
  const sceneRef = useRef<SVGSVGElement>(null)
  const [step, setStep] = useState(0)
  const [swapping, setSwapping] = useState(false)
  const [done, setDone] = useState(false)
  const [run, setRun] = useState(0)
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
  }, [])

  const play = useCallback(() => {
    clearTimers()
    setDone(false)
    setRun((n) => n + 1)
    if (reducedMotion()) {
      setStep(STEPS.length - 1)
      setDone(true)
      return
    }
    setStep(0)
    for (let i = 1; i < STEPS.length; i++) {
      timers.current.push(window.setTimeout(() => setSwapping(true), STEPS[i].at - 220))
      timers.current.push(
        window.setTimeout(() => {
          setStep(i)
          setSwapping(false)
        }, STEPS[i].at),
      )
    }
    timers.current.push(window.setTimeout(() => setDone(true), DONE_AT))
  }, [clearTimers])

  // Start once the picture is half visible; stop the timers when the page closes.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || typeof IntersectionObserver === 'undefined') {
      play()
      return clearTimers
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        play()
        io.disconnect()
      },
      { threshold: 0.45 },
    )
    io.observe(scene)
    return () => {
      io.disconnect()
      clearTimers()
    }
  }, [play, clearTimers])

  const current = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="wl-hero-visual">
      <svg
        ref={sceneRef}
        // A new key restarts every CSS animation in the picture on replay.
        key={run}
        className={cx('wl-scene', run > 0 && 'wl-playing')}
        viewBox="0 0 600 500"
        role="img"
        aria-label="A Waterline keke parks at a compound gate and pours water from jerrycans into two drums."
      >
        <defs>
          <clipPath id="wl-clip-drum-a">
            <rect x="234" y="344" width="40" height="54" rx="3" />
          </clipPath>
          <clipPath id="wl-clip-drum-b">
            <rect x="284" y="344" width="40" height="54" rx="3" />
          </clipPath>
          <clipPath id="wl-clip-roof-tank">
            <path d="M158 112Q158 96 176 94h28q18 2 18 18v46q0 8-8 8h-48q-8 0-8-8z" />
          </clipPath>
        </defs>
        <rect width="600" height="500" fill="#E3F2F5" />
        <circle cx="462" cy="104" r="44" fill="#F2B33D" />
        <g className="wl-cloud-a" fill="#fff">
          <rect x="56" y="74" width="112" height="26" rx="13" />
          <rect x="86" y="58" width="54" height="30" rx="15" />
        </g>
        <g className="wl-cloud-b" fill="#fff" opacity=".9">
          <rect x="318" y="152" width="84" height="20" rx="10" />
          <rect x="340" y="140" width="40" height="22" rx="11" />
        </g>
        <path d="M0 268C90 214 168 232 252 252S420 200 600 236V360H0Z" fill="#C3E3DD" />
        <path d="M0 300C120 262 222 302 330 286S520 258 600 290V360H0Z" fill="#9DCCC3" />

        {/* house */}
        <rect x="330" y="214" width="210" height="110" fill="#FFFFFF" />
        <rect x="500" y="214" width="40" height="110" fill="#EDF1F2" />
        <path d="M314 224L392 164h94l70 60z" fill="#C2643F" />
        <path d="M486 164l70 60h-36l-58-60z" fill="#A8532F" />
        <rect x="314" y="220" width="242" height="7" fill="#8F4628" />
        <g fill="#123E4C">
          <rect x="352" y="244" width="34" height="40" rx="3" />
          <rect x="446" y="244" width="34" height="40" rx="3" />
        </g>
        <path d="M369 244v40M352 262h34M463 244v40M446 262h34" stroke="#FFFFFF" strokeWidth="2.5" />

        {/* overhead tank on its stand */}
        <g stroke="#0C2733" strokeLinecap="round">
          <path d="M160 172l-8 130M220 172l8 130" strokeWidth="5" />
          <path d="M157 202l66 54M223 202l-66 54M154 256l72 46M226 256l-72 46" strokeWidth="2.5" opacity=".75" />
        </g>
        <rect x="146" y="164" width="88" height="9" rx="2" fill="#0C2733" />
        <path d="M158 112Q158 96 176 94h28q18 2 18 18v46q0 8-8 8h-48q-8 0-8-8z" fill="#1D8BA6" />
        <g clipPath="url(#wl-clip-roof-tank)">
          <rect x="196" y="90" width="30" height="80" fill="#17758C" />
          <path d="M156 122h70M156 136h70M156 150h70" stroke="#0E5D70" strokeWidth="2.5" opacity=".7" />
          <rect x="166" y="104" width="6" height="56" rx="3" fill="#fff" opacity=".3" />
        </g>
        <rect x="181" y="86" width="18" height="9" rx="2.5" fill="#0E4A5A" />

        {/* compound wall and gate */}
        <rect x="0" y="300" width="600" height="96" fill="#F3EFE8" />
        <path d="M0 332h342M0 364h342M490 332h110M490 364h110" stroke="#E6DFD2" strokeWidth="2" />
        <rect x="0" y="292" width="600" height="12" fill="#DDD3C2" />
        <rect x="356" y="296" width="60" height="100" fill="#0E4A5A" />
        <rect x="416" y="296" width="60" height="100" fill="#0B3E4C" />
        <path d="M366 300v92M378 300v92M390 300v92M402 300v92M428 300v92M440 300v92M452 300v92M464 300v92" stroke="#1E6476" strokeWidth="3" />
        <path d="M356 318h120M356 376h120" stroke="#0C2733" strokeWidth="4" />
        <rect x="342" y="282" width="14" height="114" fill="#DDD3C2" />
        <rect x="476" y="282" width="14" height="114" fill="#DDD3C2" />
        <rect x="338" y="276" width="22" height="8" rx="2" fill="#C9BBA0" />
        <rect x="472" y="276" width="22" height="8" rx="2" fill="#C9BBA0" />

        {/* ground */}
        <rect x="0" y="396" width="600" height="104" fill="#EFE4D0" />
        <rect x="0" y="396" width="600" height="4" fill="#DECBA8" />
        <g fill="#DCC8A4">
          <circle cx="420" cy="440" r="2.5" />
          <circle cx="470" cy="470" r="2" />
          <circle cx="540" cy="430" r="3" />
          <circle cx="380" cy="486" r="2" />
          <circle cx="560" cy="478" r="2.5" />
        </g>

        {/* drums */}
        <ellipse cx="279" cy="400" rx="56" ry="5" fill="#0C2733" opacity=".1" />
        <rect x="232" y="342" width="44" height="58" rx="5" fill="#CDE8EE" />
        <rect x="282" y="342" width="44" height="58" rx="5" fill="#CDE8EE" />
        <g clipPath="url(#wl-clip-drum-a)">
          <rect className="wl-fill-a" x="232" y="344" width="44" height="60" fill="#2FA6C1" />
        </g>
        <g clipPath="url(#wl-clip-drum-b)">
          <rect className="wl-fill-b" x="282" y="344" width="44" height="60" fill="#2FA6C1" />
        </g>
        <path d="M232 362h44M232 382h44M282 362h44M282 382h44" stroke="#8CC4D1" strokeWidth="2.5" />
        <rect className="wl-stream wl-stream-a" x="246" y="302" width="4" height="40" rx="2" fill="#2FA6C1" />
        <rect className="wl-stream wl-stream-b" x="298" y="302" width="4" height="40" rx="2" fill="#2FA6C1" />
        <rect x="230" y="338" width="48" height="7" rx="3" fill="#1D8BA6" />
        <rect x="280" y="338" width="48" height="7" rx="3" fill="#1D8BA6" />

        {/* keke */}
        <g className="wl-keke-drive">
          <ellipse cx="124" cy="455" rx="96" ry="7" fill="#0C2733" opacity=".12" />
          <g transform="translate(28 336)">
            <KekeBody srcCanClass="wl-can-src" word />
            <Wheel x={36} y={106} r={14} />
            <Wheel x={174} y={106} r={12} />
            <path d="M160 104q14-16 28 0" fill="none" stroke="#0C2733" strokeWidth="4" strokeLinecap="round" />
          </g>
        </g>

        {/* the can that pours */}
        <g className="wl-pour-can">
          <use href="#wl-can" x="-14" y="-16" width="28" height="32" color="#F2B33D" />
        </g>

        {/* delivered */}
        <g className="wl-done-badge">
          <circle cx="416" cy="252" r="20" fill="#0C2733" />
          <path d="M407 252l6 6 12-12" fill="none" stroke="#F2B33D" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>

      <div className={cx('wl-chip', last && 'wl-done')} aria-live="polite">
        <span className="wl-chip-icon">{current.icon}</span>
        <span className={cx('wl-chip-text', swapping && 'wl-swap')}>
          <b>{current.title}</b>
          <small>{current.sub}</small>
        </span>
        <span className="wl-chip-bar">
          <i key={run} className={run > 0 ? 'wl-run' : undefined} />
        </span>
      </div>
      {done && (
        <button type="button" className="wl-replay" onClick={play} aria-label="Play the delivery again">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
