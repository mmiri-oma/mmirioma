import { ClipboardList, Droplets } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { ApiStatus } from '../ApiStatus'

/**
 * Admin navigation. Only screens that exist are listed; later admin areas
 * (dispatch, drivers, reports) are added with their features, never as
 * placeholder links.
 */
const NAV_ITEMS = [{ to: '/admin/orders', label: 'Orders', icon: ClipboardList }]

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-sm">
        <Droplets aria-hidden className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight text-white">MmiriOma</span>
        <span className="block text-xs text-brand-200">Dispatch console</span>
      </span>
    </div>
  )
}

function navLinkClasses({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
    isActive ? 'bg-white/10 text-white' : 'text-brand-100 hover:bg-white/5 hover:text-white',
  )
}

/**
 * Responsive admin layout: a sidebar on large screens and a compact top bar on
 * phones and tablets (NFR-020). Pages render in the `<Outlet />`.
 */
export function AdminShell() {
  return (
    <div className="min-h-svh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-brand-950 px-4 py-6 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <nav aria-label="Admin" className="mt-8 flex-1">
          <ul className="space-y-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} className={navLinkClasses}>
                  <Icon aria-hidden className="size-4" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rounded-lg bg-white/5 px-3 py-2.5 text-brand-100 [&_p]:text-xs [&_p]:font-normal">
          <ApiStatus />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 bg-brand-950 px-4 py-3 lg:hidden">
        <Brand />
        <nav aria-label="Admin">
          <ul className="flex gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} className={navLinkClasses}>
                  <Icon aria-hidden className="size-4" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  )
}
