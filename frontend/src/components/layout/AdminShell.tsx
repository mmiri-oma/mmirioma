import { ClipboardList, Droplet, User } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  AccountPanel,
  SignOutButton,
  SignOutFailedToast,
  SignOutSecurityProblem,
} from '../../features/auth/components/AccountControls'
import { useSignOut } from '../../features/auth/useSignOut'
import type { User as SessionUser } from '../../lib/api/auth'
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
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-box bg-primary text-text-inverse">
        <Droplet aria-hidden className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-xl/7 font-bold text-text-primary">MmiriOma</span>
        <span className="block text-caption text-text-secondary">Staff</span>
      </span>
    </div>
  )
}

function navLinkClasses({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-touch items-center gap-3 rounded-md px-3 font-semibold transition-colors',
    isActive ? 'bg-primary-50 font-bold text-primary-800' : 'text-text-primary hover:bg-neutral-100',
  )
}

/**
 * Responsive admin layout (design-system.md "Sidebar navigation"): a 240 px
 * sidebar from the desktop breakpoint, a top bar below it (NFR-020). The rule
 * for staff navigation below desktop is still open (design-system.md open
 * question 2). Pages render in the `<Outlet />`.
 *
 * The signed-in staff member's name and "Sign out" (authentication design
 * X5) sit at the foot of the sidebar on desktop, and in an account panel in
 * the top bar below it. The shell is only rendered behind the staff
 * `AppGate`, so `user` is always an admin.
 */
export function AdminShell({ user }: { user: SessionUser }) {
  const signOut = useSignOut()
  return (
    <div className="min-h-svh desktop:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-3 focus:shadow-md"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface px-3 py-4 desktop:flex">
        <div className="px-1">
          <Brand />
        </div>
        <nav aria-label="Admin" className="mt-8 flex-1">
          <ul className="space-y-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} className={navLinkClasses}>
                  <Icon aria-hidden className="size-5" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="flex items-center gap-2 px-1 font-semibold">
            <User aria-hidden className="size-5 shrink-0" />
            <span className="truncate">{user.name}</span>
          </p>
          <SignOutSecurityProblem signOut={signOut} />
          <SignOutButton signOut={signOut} fullWidth />
        </div>
        <div className="mt-4 rounded-md bg-neutral-50 px-3 py-2.5 text-text-secondary [&_p]:text-caption [&_p]:font-normal">
          <ApiStatus />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2 tablet:px-6 desktop:hidden">
        <Brand />
        <nav aria-label="Admin">
          <ul className="flex gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} className={navLinkClasses}>
                  <Icon aria-hidden className="size-5" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <AccountPanel
          triggerShape="square"
          keepOpen={signOut.signingOut || signOut.problem !== null}
          trigger={
            <>
              <User aria-hidden className="size-5 shrink-0" />
              <span className="sr-only tablet:not-sr-only">Account</span>
            </>
          }
        >
          <p className="text-lg leading-[26px] font-bold">{user.name}</p>
          <div className="h-px bg-border" />
          <SignOutSecurityProblem signOut={signOut} />
          <SignOutButton signOut={signOut} fullWidth />
        </AccountPanel>
      </header>

      <main id="main" className="mx-auto max-w-300 px-4 py-6 tablet:px-6 desktop:py-10">
        <Outlet />
      </main>
      <SignOutFailedToast signOut={signOut} />
    </div>
  )
}
