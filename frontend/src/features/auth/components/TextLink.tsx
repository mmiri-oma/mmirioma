import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LINK_CLASSES =
  'inline-flex min-h-12 items-center font-bold text-primary-700 hover:text-primary-800'

/** In-app text link with a 48 px tap target (auth screens). */
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={LINK_CLASSES}>
      {children}
    </Link>
  )
}

/** External text link (`tel:`, WhatsApp) with the same look. */
export function ExternalTextLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a href={href} className={LINK_CLASSES}>
      {children}
    </a>
  )
}
