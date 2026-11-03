import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cx } from '../../lib/cx'
import { CloseIcon } from '../icons/icons'
import { IconLink } from '../ui/IconButton'
import { MobileShell } from './MobileShell'

interface DrawerMenuProps {
  /** Where closing the menu goes (the design closes to the home screen). */
  closeTo: string
  /** Accessible name of the menu, e.g. "Account menu". */
  label: string
  /** Tinted profile block at the top. */
  header: ReactNode
  /** Menu rows (MenuItem). */
  children: ReactNode
  /** Row pinned to the bottom (Log out). */
  footer?: ReactNode
  /** `blue` for customers and riders, `green` for the tanker driver app (`t-menu`). */
  tone?: 'blue' | 'green'
}

/**
 * Slide-in menu screen (`c-menu`, `r-menu`, `t-menu`): a 310 px white panel
 * over a blue-to-teal (or, for tanker drivers, green-to-teal) tinted backdrop. Tapping the backdrop, the close button
 * or pressing Escape closes it.
 *
 * The Escape listener exists only while the menu is open and is removed when
 * it unmounts.
 */
export function DrawerMenu({ closeTo, label, header, children, footer, tone = 'blue' }: DrawerMenuProps) {
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') navigate(closeTo)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, closeTo])

  return (
    <MobileShell background="ink">
      <Link
        to={closeTo}
        aria-label="Close menu"
        tabIndex={-1}
        className={cx(
          'absolute inset-0 opacity-55',
          tone === 'green' ? 'bg-[linear-gradient(160deg,#15803D,#16A0B8)]' : 'bg-[linear-gradient(160deg,#11708C,#16A0B8)]',
        )}
      />
      <nav
        aria-label={label}
        className="animate-slide-in relative flex h-full w-[310px] max-w-[85%] flex-col bg-white shadow-[16px_0_40px_rgba(0,0,0,0.25)]"
      >
        <div
          className={cx(
            'relative overflow-hidden px-5 pt-[22px]',
            tone === 'green' ? 'bg-[linear-gradient(135deg,#E7F7EE,#C9EEDA)] pb-4' : 'bg-[linear-gradient(135deg,#EEF6FF,#DCEBFD)] pb-[18px]',
          )}
        >
          {header}
          <IconLink to={closeTo} label="Close menu" className="absolute top-2 right-1.5">
            <CloseIcon size={20} strokeWidth={2.4} roundJoin={false} />
          </IconLink>
        </div>
        <div className="flex-1 overflow-y-auto py-2">{children}</div>
        {footer}
      </nav>
    </MobileShell>
  )
}
