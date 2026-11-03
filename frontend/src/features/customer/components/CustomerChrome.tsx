import { Link, useLocation } from 'react-router-dom'
import { Logo } from '../../../components/brand/Logo'
import { BottomTabBar } from '../../../components/layout/BottomTabBar'
import { MenuLink, NotificationsLink, ProfileLink, TopBar } from '../../../components/layout/MobileShell'
import { cx } from '../../../lib/cx'
import { CartIcon, DocumentLinesIcon, DocumentSolidIcon, HomeSolidIcon, PersonIcon } from '../../../components/icons/icons'
import { useSession } from '../../auth/useSession'
import { useNotifications, useProfile } from '../queries'

const TABS = [
  { to: '/home', label: 'Home', icon: (on: boolean) => <HomeSolidIcon size={22} filled={on} /> },
  { to: '/order', label: 'Order', icon: () => <CartIcon size={22} /> },
  {
    to: '/orders',
    label: 'Orders',
    icon: (on: boolean) => (on ? <DocumentSolidIcon size={22} filled /> : <DocumentLinesIcon size={22} />),
  },
  { to: '/profile', label: 'Profile', icon: () => <PersonIcon size={22} roundJoin={false} /> },
]

/** The customer bottom tab bar (`.tabs` on c-home and c-orders). */
export function CustomerTabs({ current }: { current: '/home' | '/order' | '/orders' | '/profile' }) {
  return <BottomTabBar label="Main" items={TABS} current={current} />
}

/**
 * Top bar of the customer home screens: menu, logo, notifications (with the
 * unread dot) and the profile avatar. Set `bell={false}` for screens that
 * show only the avatar on the right (c-orders).
 */
export function CustomerTopBar({ bell = true }: { bell?: boolean }) {
  const profile = useProfile()
  const notifications = useNotifications()
  const unread = notifications.data?.unread_count ?? 0
  const session = useSession()
  const name = profile.data?.name ?? session.data?.user.name ?? ''
  return (
    <TopBar
      // On a laptop the desktop header replaces this bar (components.css).
      className="mo-top-home"
      left={<MenuLink to="/menu" />}
      right={
        <div className="flex items-center gap-1">
          {bell && <NotificationsLink to="/notifications" unread={unread} />}
          <ProfileLink to="/menu" name={name || '·'} />
        </div>
      }
    />
  )
}

/** Desktop header links: the bottom tabs' destinations, named for a wide screen. */
const DESKTOP_LINKS = [
  { to: '/home', label: 'Home', match: (p: string) => p === '/home' },
  { to: '/order', label: 'Order water', match: (p: string) => p.startsWith('/order/') || p === '/order' },
  { to: '/orders', label: 'My orders', match: (p: string) => p.startsWith('/orders') },
  { to: '/addresses', label: 'Addresses', match: (p: string) => p.startsWith('/addresses') },
  { to: '/profile', label: 'Profile', match: (p: string) => p.startsWith('/profile') || p === '/menu' },
]

/**
 * The customer app's header on laptops and desktops (Waterline design): logo,
 * the main sections, notifications and the profile avatar. It replaces the
 * phone's top bar and bottom tabs there; the customer area renders it only on
 * wide screens, so phones (and tests) keep one set of navigation.
 */
export function CustomerDesktopHeader() {
  const { pathname } = useLocation()
  const profile = useProfile()
  const notifications = useNotifications()
  const unread = notifications.data?.unread_count ?? 0
  const session = useSession()
  const name = profile.data?.name ?? session.data?.user.name ?? ''
  return (
    <header className="sticky top-0 z-30 border-0 border-b border-solid border-line bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-[72px] max-w-[1120px] items-center gap-8 px-6">
        <Link to="/home" aria-label="Waterline home" className="flex shrink-0 items-center">
          <Logo height={32} alt="" />
        </Link>
        <nav aria-label="Customer app" className="flex items-center gap-1">
          {DESKTOP_LINKS.map((l) => {
            const on = l.match(pathname)
            return (
              <Link
                key={l.to}
                to={l.to}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'inline-flex min-h-11 items-center rounded-full px-4 text-[14.5px] font-semibold no-underline transition-colors duration-150',
                  on ? 'bg-sky text-primary-dark hover:text-primary-dark' : 'text-mute hover:bg-[#F3F8F9] hover:text-ink',
                )}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <NotificationsLink to="/notifications" unread={unread} />
          <ProfileLink to="/menu" name={name || '·'} />
        </div>
      </div>
    </header>
  )
}
