import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cx } from '../../lib/cx'
import { Logo } from '../brand/Logo'
import {
  BellIcon,
  ChevronDownIcon,
  CloseIcon,
  MenuIcon,
  SearchIcon,
} from '../icons/icons'
import { Avatar } from '../ui/Avatar'
import { IconButton, IconLink } from '../ui/IconButton'
import { ADMIN_NAV, currentNavPath } from './adminNav'

interface AdminShellProps {
  /** Placeholder of the header search; each page searches its own records. */
  searchPlaceholder: string
  /** Called with the search text on submit. */
  onSearch?: (query: string) => void
  /** Signed-in staff member shown top right. */
  user: { name: string; role: string }
  /** Badge counts on the sidebar (orders awaiting a rider, open support issues). */
  counts?: { orders?: number; support?: number }
  /** Unread notifications for the bell. */
  unread?: number
  children: ReactNode
}

/**
 * Admin page frame: header (logo, search, notifications, profile), 248 px
 * left sidebar with every admin section, and the page content.
 *
 * From 1024 px the sidebar sits on the left as in the design. Below that a
 * menu button in the header opens the same sidebar as a drawer, so phones and
 * tablets keep the content on screen instead of a 13-row list above it. The
 * drawer closes on navigation and on Escape.
 */
export function AdminShell({ searchPlaceholder, onSearch, user, counts = {}, unread = 0, children }: AdminShellProps) {
  const { pathname } = useLocation()
  const current = currentNavPath(pathname)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchId = useId()

  // Close the mobile drawer when the route changes (a nav link was used).
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const sidebar = (
    <nav aria-label="Admin" className="box-border flex w-sidebar shrink-0 flex-col gap-1 border-r border-line bg-white px-3.5 py-[18px]">
      {ADMIN_NAV.map((n) => {
        const on = n.to === current
        const count = n.countKey ? counts[n.countKey] : undefined
        return (
          <Link
            key={n.to}
            to={n.to}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'flex h-[42px] items-center gap-3 rounded-input px-3 text-[14px] font-semibold no-underline',
              on ? 'bg-primary text-white shadow-nav hover:text-white' : 'text-slate hover:bg-canvas hover:text-ink',
            )}
          >
            {n.icon(on)}
            {n.label}
            {count !== undefined && count > 0 && (
              <span className="ml-auto box-border flex h-5 min-w-5 items-center justify-center rounded-chip bg-red-solid px-[5px] text-[11px] font-extrabold text-white">
                {count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="min-h-dvh bg-canvas text-body text-ink">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b border-line bg-white px-4 py-3 md:gap-4 md:px-6">
        <IconButton label="Open menu" className="lg:hidden" onClick={() => setOpen(true)} aria-expanded={open}>
          <MenuIcon size={24} roundJoin={false} />
        </IconButton>
        <Link to="/admin" aria-label="Waterline admin dashboard" className="lg:mr-[52px]">
          <Logo height={34} alt="" />
        </Link>
        <form
          role="search"
          className="order-last flex h-11 max-w-[520px] flex-[1_1_100%] items-center gap-2.5 rounded-input bg-field px-3.5 text-mute md:order-none md:flex-[1_1_280px]"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch?.(query.trim())
          }}
        >
          <label htmlFor={searchId} className="sr-only">
            {searchPlaceholder}
          </label>
          <SearchIcon size={18} strokeWidth={2.2} roundJoin={false} />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-offset-4"
          />
        </form>
        <div className="ml-auto flex items-center gap-2">
          <IconLink to="/admin/notifications" label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'} dot={unread > 0}>
            <BellIcon size={22} className={unread > 0 ? 'animate-sway origin-top' : undefined} />
          </IconLink>
          <Link
            to="/admin/account"
            className="flex items-center gap-2.5 rounded-input px-2 py-1 text-ink no-underline hover:text-ink"
          >
            <Avatar name={user.name} />
            <span className="hidden flex-col leading-[1.25] sm:flex">
              <span className="font-extrabold">{user.name}</span>
              <span className="text-chip text-mute">{user.role}</span>
            </span>
            <ChevronDownIcon size={16} strokeWidth={2.2} color="#56677D" roundJoin={false} />
          </Link>
        </div>
      </header>

      <div className="flex items-stretch">
        <div className="hidden lg:flex">{sidebar}</div>
        {open && (
          <div className="fixed inset-0 z-20 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
            <button
              type="button"
              aria-label="Close menu"
              tabIndex={-1}
              className="absolute inset-0 cursor-default border-0 bg-[linear-gradient(160deg,#11708C,#16A0B8)] opacity-55"
              onClick={() => setOpen(false)}
            />
            <div className="animate-slide-in relative flex h-full flex-col overflow-y-auto bg-white shadow-[16px_0_40px_rgba(0,0,0,0.25)]">
              <div className="flex items-center justify-between px-3.5 pt-3">
                <Logo height={30} />
                <IconButton label="Close menu" onClick={() => setOpen(false)}>
                  <CloseIcon size={20} strokeWidth={2.4} roundJoin={false} />
                </IconButton>
              </div>
              {sidebar}
            </div>
          </div>
        )}
        <main className="box-border flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
