import type { CSSProperties, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cx } from '../../lib/cx'
import { Logo } from '../brand/Logo'
import { BellIcon, ChevronLeftIcon, MenuIcon } from '../icons/icons'
import { Avatar } from '../ui/Avatar'
import { IconButton, IconLink } from '../ui/IconButton'

/**
 * Frame for every phone screen (`.ph` in the design, drawn at 390 × 844).
 *
 * It fills the viewport height (`100dvh`, so the browser toolbar does not
 * hide the footer) with a fixed header, one scrolling area and a fixed footer
 * or tab bar. From 360 px up it stretches to the screen width; on tablets and
 * desktops it is a centred column at most 430 px wide on the page background,
 * so the phone layout keeps its proportions. Inside the customer area
 * (`.customer-app`), laptops get a desktop layout instead: see
 * `styles/components.css`, "Customer app on desktop".
 */
export function MobileShell({
  children,
  background = 'canvas',
  className,
}: {
  children: ReactNode
  /** Screen background: canvas (default), white (sign-in) or ink (drawer menus). */
  background?: 'canvas' | 'white' | 'ink'
  className?: string
}) {
  return (
    <div className="mo-shell min-h-dvh bg-canvas">
      <div
        className={cx(
          'mo-shell-inner relative mx-auto flex h-dvh max-w-phone flex-col overflow-hidden text-body text-ink',
          'sm:border-x sm:border-line sm:shadow-card',
          background === 'white' ? 'bg-white' : background === 'ink' ? 'bg-ink' : 'bg-canvas',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Top bar (`.top`): white, hairline bottom border, left / centre / right slots. */
export function TopBar({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode
  /** Defaults to the logo, which most screens show in the middle. */
  center?: ReactNode
  /** Defaults to a 44 px spacer so the centre stays centred. */
  right?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cx(
        'mo-top',
        className,
      )}
    >
      {left ?? <TopBarSpacer />}
      {center ?? <Logo height={30} className="mo-top-logo" />}
      {right ?? <TopBarSpacer />}
    </header>
  )
}

/** Empty 44 px slot that balances the top bar. */
export function TopBarSpacer() {
  return <span aria-hidden="true" className="w-11 shrink-0" />
}

/** Bold 17 px page title used in the top bar of list screens ("Notifications"). */
export function TopBarTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 text-[17px] font-extrabold">{children}</h1>
}

/**
 * Back arrow (22 px, stroke 2.4). `to={-1}` goes back in history, for pages
 * opened from several places (Terms, Privacy); with no history it goes home.
 */
export function BackLink({ to, label = 'Back' }: { to: string | -1; label?: string }) {
  const navigate = useNavigate()
  const icon = <ChevronLeftIcon size={22} strokeWidth={2.4} roundJoin={false} />
  if (to === -1) {
    return (
      <IconButton label={label} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app'))}>
        {icon}
      </IconButton>
    )
  }
  return (
    <IconLink to={to} label={label}>
      {icon}
    </IconLink>
  )
}

/** Hamburger that opens the drawer menu. */
export function MenuLink({ to }: { to: string }) {
  return (
    <IconLink to={to} label="Open menu">
      <MenuIcon size={24} roundJoin={false} />
    </IconLink>
  )
}

/** Bell with the gentle sway and a red dot when there is something new. */
export function NotificationsLink({ to, unread }: { to: string; unread: number }) {
  return (
    <IconLink to={to} label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'} dot={unread > 0}>
      <BellIcon size={22} className={unread > 0 ? 'animate-sway origin-top' : undefined} />
    </IconLink>
  )
}

/** Avatar in the top bar that opens the profile menu. */
export function ProfileLink({ to, name, tone }: { to: string; name: string; tone?: 'brand' | 'green' }) {
  return (
    <Link to={to} aria-label="Profile menu" className="hit-44 rounded-full no-underline">
      <Avatar name={name} tone={tone} />
    </Link>
  )
}

/** The one scrolling region of a phone screen (`.scroll`). */
export function ScrollArea({
  children,
  className,
  style,
}: {
  children: ReactNode
  /** Override padding or gap where a screen differs (e.g. `gap-3`). */
  className?: string
  style?: CSSProperties
}) {
  return (
    <main
      className={cx('mo-scroll', className)}
      style={style}
    >
      {children}
    </main>
  )
}

/** Fixed footer for the main action (`.foot`), padded above the phone's home bar. */
export function Footer({ children, row = false, className }: { children: ReactNode; row?: boolean; className?: string }) {
  return (
    <div
      className={cx(
        'mo-foot',
        row && 'flex-row gap-2.5',
        className,
      )}
    >
      {children}
    </div>
  )
}
