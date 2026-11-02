import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/brand/Logo'
import { measurementId, openCookieSettings, track } from '../../lib/analytics'
import { cx } from '../../lib/cx'
import { formatPhone } from '../../lib/format/phone'
import { InstallHowToSheet } from '../pwa/InstallParts'
import { appFor, type AppKind } from '../pwa/manifest'
import { useInstallAction } from '../pwa/useInstallAction'
import { CONTACT, NAV_LINKS, ORDER_CTA } from './content'
import { CookieConsent } from './CookieConsent'
import { PhoneIcon } from './landing/Art'
import { AreaCheckButton } from './landing/AreaCheckDialog'
import { useSupportContact } from './queries'
import './waterline.css'

/**
 * A marketing image: WebP with the PNG or JPG fallback, fixed size to stop
 * layout shift, lazy unless it is the hero (README "Images").
 */
export function Pic({
  name,
  fallback = 'png',
  width,
  height,
  alt = '',
  className,
  eager = false,
}: {
  /** File name in public/marketing without extension. */
  name: string
  fallback?: 'png' | 'jpg'
  width: number
  height: number
  alt?: string
  className?: string
  /** The first picture on the page: load now, at high priority. */
  eager?: boolean
}) {
  return (
    // `contents` lets the <img> sit in the parent's grid or flex layout
    // directly; the <source> is hidden so it never takes a grid cell itself.
    <picture className="contents">
      <source srcSet={`/marketing/${name}.webp`} type="image/webp" className="hidden" />
      <img
        src={`/marketing/${name}.${fallback}`}
        width={width}
        height={height}
        alt={alt}
        className={className}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
      />
    </picture>
  )
}

/** The Waterline logo for the public pages, light or dark. */
export function BrandLogo({ dark = false, className }: { dark?: boolean; className?: string }) {
  return <Logo variant={dark ? 'horizontal-dark' : 'horizontal'} height={36} className={cx('block w-auto', className)} />
}

/** Uppercase eyebrow label above a section title; `navy` for dark backgrounds. */
export function Kicker({ children, navy = false, className }: { children: ReactNode; navy?: boolean; className?: string }) {
  return (
    <p className={cx('m-0 text-[13px] font-bold tracking-[2px] uppercase', navy ? 'text-mk-kicker-navy' : 'text-mk-kicker', className)}>{children}</p>
  )
}

/** Header links: the area check has its own button, so "Areas" is not a link here (the footer keeps it). */
const HEADER_LINKS = NAV_LINKS.filter((l) => l.to !== '/#areas')

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/**
 * Site header for the public pages (Waterline design). It stays at the top
 * while the page scrolls, gains a hairline once scrolled, and keeps "Order
 * Water" one tap away. Below 960 px the links, phone and sign-in move into a
 * menu panel; below 600 px the order button does too (the landing page then
 * shows its order bar). The panel closes on a link tap, on Escape and on any
 * navigation, and the page behind it does not scroll while it is open.
 */
export function MarketingHeader({ current }: { current: 'home' | 'faq' }) {
  const location = useLocation()
  const contact = useSupportContact()
  // The menu belongs to the location it was opened on, so any navigation
  // (a link, Back) closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === location.key
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The hairline under the header appears once the page has scrolled.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isCurrent = (to: string) => current === 'faq' && to === '/faq'
  const phoneLabel = formatPhone(contact.phone)
  const close = () => setOpenOn(null)

  return (
    <header className={cx('wl-nav', (scrolled || open) && 'wl-scrolled')}>
      <div className="wl-wrap wl-nav-inner">
        <Link to="/" aria-label="Waterline home" className="wl-nav-brand">
          <Logo height={34} alt="" />
        </Link>
        <nav aria-label="Main" className="wl-nav-links">
          {HEADER_LINKS.map((l) => (
            <Link key={l.label} to={l.to} aria-current={isCurrent(l.to) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="wl-nav-cta">
          <AreaCheckButton className="wl-nav-area" place="header" label="Check your area">
            <PinIcon />
            <span>Check your area</span>
          </AreaCheckButton>
          <a className="wl-nav-call" href={`tel:${contact.phone}`} aria-label={`Call ${phoneLabel}`}>
            <PhoneIcon />
            <span>{phoneLabel}</span>
          </a>
          <Link className="wl-nav-signin" to="/signin">
            Sign in
          </Link>
          <Link to="/order" className="wl-btn wl-btn-primary wl-btn-sm" onClick={() => track('order_cta_click', { location: 'header' })}>
            <span>{ORDER_CTA}</span>
          </Link>
          <button
            type="button"
            className="wl-menu-btn"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="wl-mobile-menu"
            onClick={() => setOpenOn(open ? null : location.key)}
          >
            <i />
            <i />
          </button>
        </div>
      </div>
      {open && (
        <nav id="wl-mobile-menu" aria-label="Mobile" className="wl-sheet">
          <div className="wl-wrap wl-sheet-inner">
            {HEADER_LINKS.map((l, i) => (
              <Link
                key={l.label}
                to={l.to}
                onClick={close}
                aria-current={isCurrent(l.to) ? 'page' : undefined}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {l.label}
              </Link>
            ))}
            <Link to="/order" onClick={close} className="wl-btn wl-btn-primary">
              <span>{ORDER_CTA}</span>
            </Link>
            <AreaCheckButton className="wl-btn wl-btn-ghost" place="menu">
              Check your area
            </AreaCheckButton>
            <Link to="/signin" onClick={close} className="wl-btn wl-btn-ghost">
              Sign in
            </Link>
            <a href={`tel:${contact.phone}`} className="wl-btn wl-btn-ghost">
              Call {phoneLabel}
            </a>
          </div>
        </nav>
      )}
    </header>
  )
}

/**
 * Site footer (Waterline design): brand, links, account, contact, the legal
 * links and "Cookie settings", which reopens the cookie banner. The banner
 * itself is rendered here, so every public page with this footer asks for
 * consent the same way. `short` (the FAQ page) leaves out the account links.
 */
export function MarketingFooter({ variant }: { variant: 'full' | 'short' }) {
  const full = variant === 'full'
  const contact = useSupportContact()
  return (
    <>
      <footer className="wl-footer">
        <div className="wl-wrap wl-footer-grid">
          <div className="wl-footer-brand">
            <Link to="/" aria-label="Waterline home" className="inline-flex">
              <Logo variant="horizontal-dark" height={34} alt="" />
            </Link>
            <p>Water delivery for homes, offices and businesses in Enugu. Poured into your drums or tank.</p>
          </div>
          <nav aria-label="Quick Links">
            <h4>Explore</h4>
            {NAV_LINKS.map((l) => (
              <Link key={l.label} to={l.to}>
                {l.label}
              </Link>
            ))}
          </nav>
          {full ? (
            <nav aria-label="Account">
              <h4>Account</h4>
              <Link to="/order">{ORDER_CTA}</Link>
              <Link to="/signin">Sign in</Link>
              <Link to="/partner/signup">Become a Rider or Driver</Link>
              <Link to="/admin/login">Staff Login</Link>
            </nav>
          ) : (
            <span aria-hidden="true" />
          )}
          <div>
            <h4>Contact</h4>
            <span>{CONTACT.place}</span>
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
            <a href={`tel:${contact.phone}`}>{formatPhone(contact.phone)}</a>
          </div>
        </div>
        <div className="wl-wrap">
          <div className="wl-footer-base">
            <span>© 2026 Waterline. Water at your gate.</span>
            <nav aria-label="Legal" className="flex flex-wrap gap-4">
              <Link to="/terms" className="text-inherit no-underline hover:text-white">
                Terms of Service
              </Link>
              <Link to="/privacy" className="text-inherit no-underline hover:text-white">
                Privacy Notice
              </Link>
              <Link to="/privacy#cookies" className="text-inherit no-underline hover:text-white">
                Cookie Policy
              </Link>
              {measurementId() && (
                <button type="button" onClick={openCookieSettings} className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-white">
                  Cookie settings
                </button>
              )}
            </nav>
          </div>
        </div>
      </footer>
      <CookieConsent />
    </>
  )
}

/** Where "Install …" goes when this browser cannot show the install prompt (README link map). */
const FALLBACK: Record<AppKind, string> = { customer: '/signin', partner: '/partner/login' }
/** Where "Open app" goes once installed. */
const APP_HOME: Record<AppKind, string> = { customer: '/app', partner: '/partner/' }

/**
 * "Install Customer App" / "Install Driver App" (decisions Q2 and Q3).
 *
 * - The page's own app (the customer app on these pages): shows the browser's
 *   prompt, or the iPhone how-to; with neither, goes to sign-in.
 * - The partner app: a page can only install the app its manifest names, so
 *   this opens the partner login with a full page load; that page carries the
 *   partner manifest and its own install card.
 * - Already running as the installed app: "Open app".
 */
export function InstallAppButton({ app, children, className }: { app: AppKind; children: ReactNode; className: string }) {
  const action = useInstallAction()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (action.standalone || action.installed) {
    return (
      <Link to={APP_HOME[app]} className={className}>
        Open app
      </Link>
    )
  }

  async function onClick() {
    if (appFor(pathname) !== app) {
      window.location.assign(FALLBACK[app])
      return
    }
    if (!(await action.install())) navigate(FALLBACK[app])
  }

  return (
    <>
      <button type="button" onClick={() => void onClick()} className={cx('cursor-pointer border-0', className)}>
        {children}
      </button>
      {action.howToOpen && <InstallHowToSheet app={app} onClose={action.closeHowTo} />}
    </>
  )
}
