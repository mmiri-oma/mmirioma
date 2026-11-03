import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../lib/cx'

export interface TabItem {
  to: string
  label: string
  /** Icon for the tab; receives whether this tab is current (home fills when current). */
  icon: (current: boolean) => ReactNode
}

/**
 * Bottom tab bar on home screens (`.tabs`): four equal tabs, the current one
 * is blue and marked `aria-current="page"`.
 */
export function BottomTabBar({ label, items, current }: { label: string; items: TabItem[]; current: string }) {
  return (
    <nav
      aria-label={label}
      className="mo-tabs grid shrink-0 grid-cols-4 border-t border-line bg-white px-1.5 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      {items.map((item) => {
        const on = item.to === current
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'flex min-h-11 flex-col items-center gap-[3px] py-1 text-tab font-semibold no-underline',
              on ? 'text-primary hover:text-primary' : 'text-mute hover:text-ink',
            )}
          >
            {item.icon(on)}
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
