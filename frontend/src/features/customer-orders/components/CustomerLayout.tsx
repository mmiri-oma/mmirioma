import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { User } from '../../../lib/api/auth'
import { cn } from '../../../lib/cn'
import { CustomerHeader } from '../../auth/components/CustomerHeader'
import { useCustomerOrdersSource } from '../source'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex min-h-touch items-center rounded-md px-3.5 font-semibold',
    isActive ? 'bg-primary-50 text-primary-800' : 'text-text-primary hover:bg-neutral-100',
  )

/**
 * Desktop top-bar links from the customer ordering design. `aria-current`
 * marks the open page (set by `NavLink`).
 */
function CustomerNav() {
  return (
    <nav aria-label="Main" className="flex gap-1">
      <NavLink to="/" end className={navLinkClass}>
        My orders
      </NavLink>
      <NavLink to="/request" className={navLinkClass}>
        Request water
      </NavLink>
    </nav>
  )
}

/**
 * Banner shown while the customer screens use the mock data source, so a
 * simulated request is never taken for a real one (BR-09). Styled as the
 * design system's warning alert.
 */
export function SampleOrdersNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-box border border-warning-200 bg-warning-50 px-4 py-3.5 text-warning-800"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p>
        <strong className="font-bold">Sample data.</strong> Orders on these screens are
        simulated and requests are not sent to MmiriOma. No water will be delivered.
      </p>
    </div>
  )
}

export interface CustomerLayoutProps {
  user: User
  children: ReactNode
}

/**
 * Page frame of the signed-in customer screens (O1-O4): the customer header
 * from the auth design (X5) with the desktop links, the sample-data notice
 * while mock data is used, and a centred column (720 px of content).
 */
export function CustomerLayout({ user, children }: CustomerLayoutProps) {
  const source = useCustomerOrdersSource()
  return (
    <div className="min-h-svh bg-background">
      <CustomerHeader user={user} nav={<CustomerNav />} />
      <main className="flex flex-col gap-4 px-4 pt-5 pb-6 tablet:mx-auto tablet:max-w-[768px] tablet:gap-5 tablet:px-6 tablet:pt-10 tablet:pb-14">
        {source.isMock ? <SampleOrdersNotice /> : null}
        {children}
      </main>
    </div>
  )
}
