import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../../lib/analytics'
import { cx } from '../../lib/cx'
import { formatPhone } from '../../lib/format/phone'
import { AREA_NAMES, LANDING_FAQS, OBJECTIONS, ORDER_CTA } from './content'
import { ArrowIcon, ArtDefs, CheckIcon, DropIcon, PhoneIcon, TankerArt } from './landing/Art'
import { AreaCheck } from './landing/AreaCheck'
import { AreaCheckButton } from './landing/AreaCheckDialog'
import { HeroScene } from './landing/HeroScene'
import { SizePicker } from './landing/SizePicker'
import { InstallAppButton, MarketingFooter, MarketingHeader } from './MarketingParts'
import { useSupportContact } from './queries'
import { FloatingActions } from './SiteExtras'
import { useMarketingPage } from './useMarketingPage'
import './waterline.css'

/** The sample delivery code drawn on the phone: 6 digits, like the real one (FR-035). */
const SAMPLE_CODE = '481735'.split('')

/**
 * Public landing page at `/`, Waterline design: the delivery story told by
 * a moving picture, the four steps, a size picker, the delivery code, drivers,
 * install, areas, questions and a closing button.
 *
 * Honesty rules for this page (docs/process/ui-driven-development.md): no
 * prices (they come from the server once there is an address), no live
 * tracking, no water-quality claims, and the area list is marked as a sample.
 */
export function Landing() {
  useMarketingPage(
    'Water delivery in Enugu, poured into your tank | Waterline',
    'Order water in Enugu by keke or tanker. We pour it straight into your drums or tank. See the full price before you confirm and pay cash on delivery.',
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const contact = useSupportContact()
  const phoneLabel = formatPhone(contact.phone)
  const phoneHref = `tel:${contact.phone}`

  useReveal(rootRef)
  const { progress, gauge, dock } = useScrollState(rootRef)

  return (
    <div className="wl" ref={rootRef}>
      <ArtDefs />
      <MarketingHeader current="home" />
      <main>
        <Hero />
        <Marquee />
        <Why />
        <HowItWorks progress={progress} />
        <Sizes />
        <Trust />
        <Drivers />
        <InstallSection />
        <Areas phoneLabel={phoneLabel} phoneHref={phoneHref} />
        <Questions phoneLabel={phoneLabel} phoneHref={phoneHref} />
        <Closing phoneLabel={phoneLabel} phoneHref={phoneHref} />
      </main>
      <MarketingFooter variant="full" />
      <div className={cx('wl-dock', dock && 'wl-show')} aria-hidden={!dock}>
        <OrderLink location="dock" tabIndex={dock ? 0 : -1} />
      </div>
      <div className="wl-gauge" aria-hidden="true">
        <div className="wl-gauge-tube">
          <i style={{ height: `${gauge}%` }} />
        </div>
        <span>{gauge}%</span>
      </div>
      <FloatingActions />
    </div>
  )
}

/** The main "Order Water" button. Opens the app's order flow (sign-in first when signed out). */
function OrderLink({ location, tone = 'primary', tabIndex }: { location: string; tone?: 'primary' | 'sun'; tabIndex?: number }) {
  return (
    <Link
      to="/order"
      tabIndex={tabIndex}
      className={cx('wl-btn', tone === 'sun' ? 'wl-btn-sun' : 'wl-btn-primary')}
      onClick={() => track('order_cta_click', { location })}
    >
      <span>{ORDER_CTA}</span>
      <ArrowIcon />
    </Link>
  )
}

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={cx('wl-eyebrow', dark && 'wl-on-dark')}>{children}</p>
}

/**
 * Fades sections in as they scroll into view. Only runs where
 * IntersectionObserver exists, so without it (old browsers, tests) every
 * section is simply visible.
 */
function useReveal(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    root.classList.add('wl-js')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.add('wl-in')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    )
    root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [rootRef])
}

/**
 * Scroll-driven values: how far the "How it works" pipe has filled (0 to 1),
 * how far down the page the visitor is (the gauge, in %), and whether the
 * phone order bar shows (past the hero, not over the closing band).
 * One passive listener, throttled to animation frames.
 */
function useScrollState(rootRef: React.RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState({ progress: 0, gauge: 0, dock: false })
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const root = rootRef.current
      if (!root) return
      const vh = window.innerHeight
      const max = document.documentElement.scrollHeight - vh
      const gauge = max > 0 ? Math.round(Math.min(1, window.scrollY / max) * 100) : 0
      const steps = root.querySelector('.wl-steps')?.getBoundingClientRect()
      const progress = steps ? Math.max(0, Math.min(1, (vh * 0.72 - steps.top) / (steps.height || 1))) : 0
      const hero = root.querySelector('.wl-hero')?.getBoundingClientRect()
      const cta = root.querySelector('.wl-cta')?.getBoundingClientRect()
      const dock = Boolean(hero && hero.bottom < vh * 0.4 && (!cta || cta.top > vh * 0.9))
      setState((s) => (s.progress === progress && s.gauge === gauge && s.dock === dock ? s : { progress, gauge, dock }))
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
    }
  }, [rootRef])
  return state
}

/** Adds `wl-play` the first time an element is a third on screen (the phone and the tanker). */
function usePlayOnView<T extends Element>() {
  const ref = useRef<T>(null)
  const [play, setPlay] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setPlay(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setPlay(true)
        io.disconnect()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, play] as const
}

function Hero() {
  return (
    <section className="wl-hero" id="top">
      <div className="wl-wrap wl-hero-grid">
        <div>
          {/* The eyebrow is part of the main heading, so the page's h1 says what it is about in search terms. */}
          <h1 className="wl-h1 wl-hero-title">
            <span className="wl-eyebrow wl-hero-eyebrow">Water delivery in Enugu</span>
            <span className="wl-line">
              <span>Water at</span>
            </span>{' '}
            <span className="wl-line">
              <span>
                your <em>gate.</em>
              </span>
            </span>
          </h1>
          <p className="wl-hero-lede wl-rise" style={{ animationDelay: '.38s' }}>
            Order on your phone. We bring the water by keke or tanker and pour it straight into your drums or tank.
          </p>
          <div className="wl-hero-actions wl-rise" style={{ animationDelay: '.48s' }}>
            <OrderLink location="hero" />
            <AreaCheckButton className="wl-btn wl-btn-ghost" place="hero">
              Do you deliver to me?
            </AreaCheckButton>
          </div>
          <ul className="wl-hero-points wl-rise" style={{ animationDelay: '.58s' }}>
            {['Poured into your drums or tank', 'Full price before you confirm', 'Done only when you give your code'].map((p) => (
              <li key={p}>
                <CheckIcon />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <HeroScene />
      </div>
    </section>
  )
}

function Marquee() {
  return (
    <div className="wl-marquee" aria-hidden="true">
      <div className="wl-marquee-track">
        {[...AREA_NAMES, ...AREA_NAMES].map((a, i) => (
          <span key={i}>{a}</span>
        ))}
      </div>
    </div>
  )
}

const WHY: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'No more carrying water',
    text: 'We bring it to your gate. You never lift a jerrycan.',
    icon: <path d="M6 8h10l3 3v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM8.5 8V5h5v3M3 3l18 18" />,
  },
  {
    title: 'Poured in for you',
    text: 'Keke riders pour into your drums. Tanker drivers pump into your tank.',
    icon: <path d="M7 11h10v9a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1zM6 11h12M7 16h10M12 2.5s-2.5 2.8-2.5 4.3a2.5 2.5 0 0 0 5 0c0-1.5-2.5-4.3-2.5-4.3z" />,
  },
  {
    title: 'No price surprises',
    text: 'You see the full price before you confirm. Your order keeps that price.',
    icon: <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8.5-8.5 8.5zM8 8h.01" />,
  },
  {
    title: 'You confirm the delivery',
    text: 'The rider can only finish once you give your delivery code.',
    icon: (
      <>
        <rect x="3" y="7" width="18" height="10" rx="2" />
        <path d="M7.5 12h.01M10.5 12h.01M13.5 12h.01M16.5 12h.01" />
      </>
    ),
  },
]

function Why() {
  return (
    <section className="wl-section">
      <div className="wl-wrap wl-why-grid">
        <div className="wl-why-head" data-reveal>
          <Eyebrow>Why Waterline</Eyebrow>
          <h2 className="wl-h2">
            Water, without the <em>wahala.</em>
          </h2>
          <p className="wl-lede">You order. We bring the water and pour it in. You check it, then give your code.</p>
          <Link to="/#how" className="wl-link-arrow">
            See how it works <ArrowIcon />
          </Link>
        </div>
        <ol className="wl-why-list">
          {WHY.map((w, i) => (
            <li key={w.title} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="wl-why-num">0{i + 1}</span>
              <svg className="wl-why-icon" viewBox="0 0 24 24" aria-hidden="true">
                {w.icon}
              </svg>
              <h3 className="wl-h3">{w.title}</h3>
              <p>{w.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const STEPS: { title: string; text: string; art: ReactNode }[] = [
  {
    title: 'Order',
    text: 'Pick keke or tanker, the size and your address.',
    art: (
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <rect x="40" y="6" width="40" height="72" rx="8" fill="#0C2733" />
        <rect x="44" y="12" width="32" height="60" rx="4" fill="#DCEFEF" />
        <rect x="48" y="18" width="24" height="10" rx="3" fill="#fff" />
        <rect x="48" y="31" width="24" height="10" rx="3" fill="#1D8BA6" />
        <rect x="48" y="44" width="15" height="4" rx="2" fill="#0C2733" opacity=".25" />
        <rect x="48" y="58" width="24" height="9" rx="4.5" fill="#F2B33D" />
        <circle className="wl-tap" cx="66" cy="62" r="9" fill="none" stroke="#1D8BA6" strokeWidth="2" />
      </svg>
    ),
  },
  {
    title: 'We bring it',
    text: 'A rider collects the water and heads straight to you.',
    art: (
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <path d="M2 40h12M6 50h10M0 60h14" stroke="#9FB9BF" strokeWidth="3" strokeLinecap="round" />
        <g className="wl-bob">
          <use href="#wl-keke" x="18" y="16" width="96" height="61" />
        </g>
        <path d="M0 80h120" stroke="#DDD3C2" strokeWidth="3" />
      </svg>
    ),
  },
  {
    title: 'We pour it',
    text: 'Into your drums, or your ground or overhead tank.',
    art: (
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <defs>
          <clipPath id="wl-clip-mini-drum">
            <rect x="46" y="42" width="30" height="36" rx="3" />
          </clipPath>
        </defs>
        <rect x="44" y="40" width="34" height="40" rx="4" fill="#CDE8EE" />
        <g clipPath="url(#wl-clip-mini-drum)">
          <rect className="wl-mini-fill" x="44" y="42" width="34" height="40" fill="#2FA6C1" />
        </g>
        <rect x="42" y="37" width="38" height="6" rx="3" fill="#1D8BA6" />
        <rect className="wl-mini-stream" x="58" y="18" width="3.5" height="20" rx="1.75" fill="#2FA6C1" />
        <g transform="translate(50 12) rotate(100)">
          <use href="#wl-can" x="-11" y="-13" width="22" height="26" color="#F2B33D" />
        </g>
      </svg>
    ),
  },
  {
    title: 'Give your code',
    text: 'Share your 6-digit delivery code once all the water is in.',
    art: (
      <svg viewBox="0 0 120 84" aria-hidden="true">
        <g fontFamily="Fraunces, Georgia, serif" fontSize="13" fontWeight="600" textAnchor="middle" fill="#0C2733">
          {SAMPLE_CODE.map((d, i) => (
            <g key={i}>
              <rect x={4 + i * 19} y="30" width="16" height="24" rx="4" fill="#fff" stroke="#DDD3C2" />
              <text x={12 + i * 19} y="47">
                {d}
              </text>
            </g>
          ))}
        </g>
        <circle cx="108" cy="20" r="10" fill="#0C2733" />
        <path d="M103.5 20l3 3 6-6" fill="none" stroke="#F2B33D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
]

function HowItWorks({ progress }: { progress: number }) {
  return (
    <section className="wl-section wl-tint" id="how">
      <div className="wl-wrap">
        <div className="wl-section-head" data-reveal>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="wl-h2">
            Four steps from order to a <em>full tank.</em>
          </h2>
        </div>
        <div className="wl-steps">
          <div className="wl-pipe" aria-hidden="true">
            <i style={{ height: `${progress * 100}%`, width: `${progress * 100}%` }} />
          </div>
          {STEPS.map((s, i) => (
            // A step lights up once the water in the pipe reaches it.
            <article key={s.title} className={cx('wl-step', progress >= i / STEPS.length && 'wl-on')}>
              <span className="wl-node" aria-hidden="true" />
              <div className="wl-step-art">{s.art}</div>
              <span className="wl-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="wl-h3">{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Sizes() {
  return (
    <section className="wl-section" id="sizes">
      <div className="wl-wrap">
        <div className="wl-section-head wl-split" data-reveal>
          <div>
            <Eyebrow>Keke or tanker</Eyebrow>
            <h2 className="wl-h2">
              Pick the size <em>that fits.</em>
            </h2>
          </div>
          <p className="wl-lede">Keke for drums at home, work or a small shop. Tanker to fill a whole tank for big homes, businesses and estates.</p>
        </div>
        <SizePicker />
      </div>
    </section>
  )
}

function Trust() {
  const [phoneRef, phonePlay] = usePlayOnView<HTMLDivElement>()
  return (
    <section className="wl-section wl-trust" id="trust">
      <div className="wl-wrap wl-trust-grid">
        <div data-reveal>
          <Eyebrow dark>Before you order</Eyebrow>
          <h2 className="wl-h2">
            Your code.
            <br />
            <em>Your call.</em>
          </h2>
          <p className="wl-lede">
            When the water is in, we text you a 6-digit delivery code. The rider can only finish the order once you give it, so check your drums
            or tank first.
          </p>
          <div ref={phoneRef} className={cx('wl-phone', phonePlay && 'wl-play')}>
            <div className="wl-phone-screen">
              <div className="wl-sms-head">
                <span className="wl-avatar">
                  <DropIcon />
                </span>
                <div>
                  <b>Waterline</b>
                  <small>Text message · Sample</small>
                </div>
              </div>
              <p className="wl-sms">
                Your water has been unloaded. Your delivery code is <b>{SAMPLE_CODE.join('')}</b>. Check your water first, then share this code with
                your rider.
              </p>
              <div className="wl-otp" role="img" aria-label={`Sample delivery code ${SAMPLE_CODE.join(' ')}`}>
                {SAMPLE_CODE.map((d, i) => (
                  <span key={i} style={{ animationDelay: `${1 + i * 0.22}s` }}>
                    {d}
                  </span>
                ))}
              </div>
              <p className="wl-otp-done">
                <CheckIcon />
                Delivery complete
              </p>
            </div>
          </div>
        </div>
        <div>
          <h3 className="wl-worries-title" data-reveal>
            Worried about something? Read this.
          </h3>
          {OBJECTIONS.map((o, i) => (
            <article key={o.q} className="wl-worry" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <h4>{o.q}</h4>
              <p>{o.a}</p>
            </article>
          ))}
          <article className="wl-worry" data-reveal>
            <h4>How do I pay?</h4>
            <p>During the pilot you pay cash on delivery, after the water has been unloaded.</p>
          </article>
        </div>
      </div>
    </section>
  )
}

const APPROVAL: [string, string][] = [
  ['Apply in the driver app', 'Say if you ride a keke or drive a tanker.'],
  ['Upload your papers', "Valid ID, driver's licence and vehicle papers."],
  ['We check you', 'Our team reviews your details and your vehicle.'],
  ['Start taking orders', 'Go online and accept orders near you.'],
]

function Drivers() {
  const [roadRef, roadPlay] = usePlayOnView<HTMLDivElement>()
  return (
    <section className="wl-section" id="drivers">
      <div className="wl-wrap">
        <div className="wl-drivers-top">
          <div data-reveal>
            <Eyebrow>For riders and drivers</Eyebrow>
            <h2 className="wl-h2">
              Deliver water.
              <br />
              <em>Get paid per trip.</em>
            </h2>
            <p className="wl-lede">Use your own keke or tanker. Take orders near you and see what you earn on every delivery.</p>
            <ul className="wl-perks">
              {['Pay for every delivery', 'Keke or tanker', 'Go online when you choose'].map((p) => (
                <li key={p}>
                  <span className="wl-drop-dot" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
            <Link to="/partner/signup" className="wl-btn wl-btn-primary" onClick={() => track('driver_cta_click', { location: 'drivers' })}>
              <span>Become a Rider or Driver</span>
              <ArrowIcon />
            </Link>
          </div>
          <div ref={roadRef} className={cx('wl-road', roadPlay && 'wl-play')}>
            <TankerArt />
          </div>
        </div>
        <div className="wl-approval">
          <h3 data-reveal>How approval works</h3>
          <ol>
            {APPROVAL.map(([title, text], i) => (
              <li key={title} data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
                <span>{i + 1}</span>
                <div>
                  <h4>{title}</h4>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

function InstallSection() {
  return (
    <section className="wl-section wl-tint" id="app">
      <div className="wl-wrap">
        <div className="wl-section-head wl-split" data-reveal>
          <div>
            <Eyebrow>No app store needed</Eyebrow>
            <h2 className="wl-h2">
              Put Waterline <em>on your phone.</em>
            </h2>
          </div>
          <p className="wl-lede">Install it straight from your browser. It opens from your home screen like any app, and takes almost no space.</p>
        </div>
        <div className="wl-app-grid">
          <article className="wl-app-card" data-reveal>
            <div className="wl-mini-phone" aria-hidden="true">
              <div className="wl-mini-screen">
                <p className="wl-mini-top">Your order</p>
                <div className="wl-mini-card">
                  <span className="wl-tag">Keke</span>
                  <b>24 gallons · 25 L</b>
                  <small>Sample order</small>
                </div>
                <ol className="wl-mini-steps">
                  <li className="wl-done">Ordered</li>
                  <li className="wl-done">On the way</li>
                  <li className="wl-now">Pouring in</li>
                  <li>Give your code</li>
                </ol>
              </div>
            </div>
            <div>
              <Eyebrow>For customers</Eyebrow>
              <h3>Order water and follow each step of your delivery.</h3>
              <InstallAppButton app="customer" className="wl-btn wl-btn-primary">
                Install the customer app
              </InstallAppButton>
            </div>
          </article>
          <article className="wl-app-card wl-dark" data-reveal style={{ transitionDelay: '90ms' }}>
            <div className="wl-mini-phone" aria-hidden="true">
              <div className="wl-mini-screen">
                <p className="wl-mini-top">New order near you</p>
                <div className="wl-mini-card">
                  <span className="wl-tag">Tanker</span>
                  <b>1,000 gallons</b>
                  <small>Overhead tank · Sample</small>
                </div>
                <div className="wl-mini-actions">
                  <span>Skip</span>
                  <span className="wl-go">Accept</span>
                </div>
              </div>
            </div>
            <div>
              <Eyebrow dark>For riders and drivers</Eyebrow>
              <h3>Get orders, deliver them and see what you have earned.</h3>
              <InstallAppButton app="partner" className="wl-btn wl-btn-light">
                Install the driver app
              </InstallAppButton>
            </div>
          </article>
        </div>
        <div className="wl-howto" data-reveal>
          <p>
            <b>Android:</b> open the link in Chrome, tap <kbd>⋮</kbd> then <em>Add to Home screen</em>.
          </p>
          <p>
            <b>iPhone:</b> open the link in Safari, tap <kbd>Share</kbd> then <em>Add to Home Screen</em>.
          </p>
        </div>
      </div>
    </section>
  )
}

function Areas({ phoneLabel, phoneHref }: { phoneLabel: string; phoneHref: string }) {
  return (
    <section className="wl-section" id="areas">
      <div className="wl-wrap wl-areas-grid">
        <div data-reveal>
          <Eyebrow>Where we deliver</Eyebrow>
          <h2 className="wl-h2">
            Is your street <em>on our route?</em>
          </h2>
          <p className="wl-lede">These are the areas we plan to serve in Enugu. It is a sample list: our first zone is still being confirmed, so ask us before you order.</p>
        </div>
        <div data-reveal>
          <AreaCheck areas={AREA_NAMES} phoneLabel={phoneLabel} phoneHref={phoneHref} />
        </div>
      </div>
    </section>
  )
}

function Questions({ phoneLabel, phoneHref }: { phoneLabel: string; phoneHref: string }) {
  return (
    <section className="wl-section wl-tint" id="faq">
      <div className="wl-wrap wl-faq-grid">
        <div data-reveal>
          <Eyebrow>Questions</Eyebrow>
          <h2 className="wl-h2">
            Asked <em>and answered.</em>
          </h2>
          <p className="wl-lede">
            Still stuck? Call <a href={phoneHref}>{phoneLabel}</a> and a person picks up, or <Link to="/faq">read all answers</Link>.
          </p>
        </div>
        <div className="wl-accordion" data-reveal>
          {LANDING_FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function Closing({ phoneLabel, phoneHref }: { phoneLabel: string; phoneHref: string }) {
  return (
    <section className="wl-cta" aria-labelledby="wl-closing-title">
      <div className="wl-wrap wl-cta-inner">
        <h2 className="wl-h2" id="wl-closing-title">
          Drums running <em>low?</em>
        </h2>
        <p>Order now. We bring it, pour it in, and you give the code.</p>
        <div className="wl-cta-actions">
          <OrderLink location="closing" tone="sun" />
          <a className="wl-btn wl-btn-light-ghost" href={phoneHref}>
            <PhoneIcon />
            <span>Call {phoneLabel}</span>
          </a>
        </div>
      </div>
      <svg className="wl-cta-wave" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 60Q180 20 360 60T720 60T1080 60T1440 60T1800 60T2160 60V120H0Z" />
      </svg>
    </section>
  )
}
