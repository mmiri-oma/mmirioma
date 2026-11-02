import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../../components/brand/Logo'
import { cx } from '../../lib/cx'
import { formatPhone } from '../../lib/format/phone'
import { useSupportContact } from '../marketing/queries'
import '../marketing/waterline.css'

interface AuthShellProps {
  children: ReactNode
  /**
   * How much of the form is filled in correctly, 0 to 1. The tank in the side
   * panel fills to match, so the visitor sees their progress; it is decoration
   * only and says nothing the form does not.
   */
  progress: number
  /** Side panel heading. Put the second half in `<em>` for the italic accent. */
  title: ReactNode
  /** Short reassurances under the heading (desktop only). */
  points: string[]
  /** `dark` for the staff sign-in, so staff can tell it apart at a glance. */
  tone?: 'light' | 'dark'
  /** Where "Back" goes; the public home page by default. */
  back?: { to: string; label: string }
  /** Show the full tank with a tick (after a success). */
  done?: boolean
}

/** Ripple rings behind the tank, the same texture as the landing page's size picker. */
const RIPPLES = (rgba: string) => `repeating-radial-gradient(circle at 72% 38%, transparent 0 38px, ${rgba} 38px 39.5px)`

/** Water surface path for the tank: one hump up and one down every 80 units, wide enough to slide. */
function wavePath(top: number, amp: number): string {
  let d = `M-240 ${top}`
  for (let x = -240; x < 620; x += 80) d += ` q20 ${-amp} 40 0 t40 0`
  return `${d} V${top + 400} H-240 Z`
}

const TANK_BODY = 'M116 86Q116 54 150 52h60q34 2 34 34v110q0 10-10 10H126q-10 0-10-10z'

/** An overhead tank on its stand, filled to `level` (0 to 1) with a moving surface. */
function ProgressTank({ level, dark, done }: { level: number; dark: boolean; done: boolean }) {
  const steel = dark ? '#5C7F8A' : '#0C2733'
  return (
    <svg viewBox="0 0 360 370" className="block h-auto w-full overflow-visible" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="wl-auth-tank">
          <path d={TANK_BODY} />
        </clipPath>
      </defs>
      <g stroke={steel} strokeLinecap="round">
        <path d="M128 214l-10 136M232 214l10 136" strokeWidth="7" />
        <path d="M124 248l112 46M236 248l-112 46M121 300l118 44M239 300l-118 44" strokeWidth="3.5" opacity=".7" />
      </g>
      <rect x="108" y="206" width="144" height="12" rx="3" fill={steel} />
      <path d={TANK_BODY} fill="#E3F1F2" />
      <g clipPath="url(#wl-auth-tank)">
        <g className="wl-water" style={{ transform: `translateY(${(1 - level) * 154}px)` }}>
          <path className="wl-wave-back" d={wavePath(49, 4)} fill="#1D8BA6" />
          <path className="wl-wave-front" d={wavePath(55, 5)} fill="#3FB3C8" />
        </g>
        <g stroke="#0C2733" strokeWidth="3" opacity=".08">
          <path d="M110 92h140M110 122h140M110 152h140M110 182h140" />
        </g>
        <rect x="128" y="70" width="9" height="122" rx="4.5" fill="#fff" opacity=".35" />
      </g>
      <path d={TANK_BODY} fill="none" stroke="#0E4A5A" strokeOpacity=".3" strokeWidth="2" />
      <rect x="162" y="40" width="36" height="13" rx="4" fill="#0E4A5A" />
      {done && (
        <g>
          <circle cx="180" cy="130" r="26" fill="#0C2733" />
          <path d="M168 130l8 8 16-16" fill="none" stroke="#F2B33D" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  )
}

/**
 * Layout for every sign-in and sign-up screen (customer, rider/driver, staff),
 * Waterline design. On a laptop: a side panel with the logo, a tank that
 * fills as the form is completed and a few reassurances, next to the form. On
 * a phone: a slim band with the logo and a small tank above the form.
 */
export function AuthShell({ children, progress, title, points, tone = 'light', back = { to: '/', label: 'Home' }, done = false }: AuthShellProps) {
  const dark = tone === 'dark'
  const contact = useSupportContact()
  const level = done ? 1 : 0.12 + 0.88 * Math.max(0, Math.min(1, progress))
  return (
    <div className="grid min-h-dvh bg-white font-marketing text-ink lg:grid-cols-[minmax(400px,42%)_1fr]">
      <aside
        aria-hidden="true"
        className={cx(
          'relative flex items-center justify-between gap-4 overflow-hidden px-4 py-2.5 sm:px-6',
          'lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:items-start lg:justify-between lg:px-14 lg:pt-9 lg:pb-12',
          dark ? 'bg-ink text-white' : 'bg-[#E6F3F5]',
        )}
        style={{ backgroundImage: RIPPLES(dark ? 'rgba(92,198,212,.08)' : 'rgba(29,139,166,.07)') }}
      >
        <Logo variant={dark ? 'horizontal-dark' : 'horizontal'} height={32} alt="" />
        <div className="w-[58px] lg:w-[min(100%,330px)] lg:self-center">
          <ProgressTank level={level} dark={dark} done={done} />
        </div>
        <div className="hidden lg:block">
          <p
            className={cx(
              'm-0 max-w-[15ch] font-display text-[clamp(1.9rem,2.6vw,2.5rem)] leading-[1.08] font-medium tracking-[-0.022em] [&_em]:font-normal [&_em]:italic',
              dark ? '[&_em]:text-[#5CC6D4]' : '[&_em]:text-[#1D8BA6]',
            )}
          >
            {title}
          </p>
          <ul className={cx('m-0 mt-[22px] grid list-none gap-2.5 p-0 text-[15px]', dark ? 'text-white/75' : 'text-[#3D5560]')}>
            {points.map((p) => (
              <li key={p} className="flex items-center gap-2.5">
                <span className={cx('size-2 shrink-0 -rotate-45 rounded-[50%_0_50%_50%]', dark ? 'bg-[#5CC6D4]' : 'bg-[#1D8BA6]')} />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="flex min-w-0 flex-col px-4 pb-6 sm:px-6">
        <div className="mx-auto flex h-16 w-full max-w-[440px] items-center gap-4 lg:h-[84px]">
          <Link to={back.to} className="mr-auto inline-flex min-h-11 items-center gap-1.5 text-[14.5px] font-semibold text-mute no-underline hover:text-ink">
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
          <a href={`tel:${contact.phone}`} className="inline-flex min-h-11 items-center gap-1.5 text-[14.5px] font-semibold text-primary-dark no-underline hover:text-ink">
            <span className="max-[400px]:hidden">Need help?</span> {formatPhone(contact.phone)}
          </a>
        </div>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col gap-4 pt-[clamp(8px,4vh,56px)] pb-9">{children}</div>
      </main>
    </div>
  )
}
