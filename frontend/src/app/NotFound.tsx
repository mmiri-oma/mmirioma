import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Illustration } from '../components/brand/Illustration'
import { Logo } from '../components/brand/Logo'
import { MessageCircleIcon } from '../components/icons/icons'
import { ButtonLink } from '../components/ui/Button'
import { ORDER_CTA } from '../features/marketing/content'
import { useSupportContact } from '../features/marketing/queries'
import { formatPhone } from '../lib/format/phone'
import { WHATSAPP_GREETING, whatsappLink } from '../lib/whatsapp'

/** Where to send someone, by the part of the site the broken link was in. */
function waysOut(pathname: string): { primary: { to: string; label: string }; home: string } {
  if (pathname.startsWith('/partner')) return { primary: { to: '/partner/', label: 'Go to the driver app' }, home: '/' }
  if (pathname.startsWith('/admin')) return { primary: { to: '/admin', label: 'Go to the dashboard' }, home: '/' }
  return { primary: { to: '/order', label: ORDER_CTA }, home: '/' }
}

/**
 * Shown for any address that is not a page: one clear message, the most
 * useful next step for that part of the site (order water, the driver app or
 * the admin dashboard), the home page, and a WhatsApp link for help. Not in
 * the handoff; built from the app's own logo, illustration and buttons.
 */
export function NotFound() {
  const { pathname } = useLocation()
  const { phone, whatsapp } = useSupportContact()
  const { primary, home } = waysOut(pathname)

  useEffect(() => {
    const before = document.title
    document.title = 'Page not found | Waterline'
    return () => {
      document.title = before
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-[linear-gradient(180deg,#F3F9FE_0%,#FFFFFF_60%)] text-ink">
      <header className="mx-auto flex w-full max-w-[1100px] items-center px-4 py-4 sm:px-6">
        <Link to="/" aria-label="Waterline home" className="flex min-h-11 items-center">
          <Logo height={34} alt="" />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center sm:px-6">
        <div className="rise-1 flex w-full max-w-[460px] flex-col items-center gap-4">
          <Illustration name="jerrycan" className="animate-float h-28 w-auto" />
          <p aria-hidden="true" className="m-0 text-[64px] leading-none font-extrabold tracking-[-2px] text-primary">
            404
          </p>
          <h1 className="m-0 text-[28px] leading-[1.2] font-extrabold">This page doesn't exist</h1>
          <p className="m-0 text-[16px] leading-[1.55] text-slate">The link may be old or mistyped. Pick where to go next.</p>
          <div className="mt-2 flex w-full flex-col gap-2.5 sm:flex-row">
            <ButtonLink to={primary.to} className="sm:flex-1">
              {primary.label}
            </ButtonLink>
            <ButtonLink to={home} variant="line" className="sm:flex-1">
              Go to the home page
            </ButtonLink>
          </div>
          {whatsapp ? (
            <a
              href={whatsappLink(whatsapp, WHATSAPP_GREETING)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 text-[15px] font-bold text-primary no-underline hover:text-primary-dark"
            >
              <MessageCircleIcon size={18} />
              Need help? Chat with us on WhatsApp
            </a>
          ) : (
            <a href={`tel:${phone}`} className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 text-[15px] font-bold text-primary no-underline hover:text-primary-dark">
              Need help? Call us on {formatPhone(phone)}
            </a>
          )}
        </div>
      </main>
    </div>
  )
}
