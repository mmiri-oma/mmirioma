import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../lib/cx'

/** Screen title and subtitle (`.h1` + `.sub`). */
export function ScreenHeading({
  title,
  sub,
  className,
  titleClassName,
}: {
  title: ReactNode
  sub?: ReactNode
  className?: string
  /** Override the 24 px title size where a screen draws it larger or smaller. */
  titleClassName?: string
}) {
  return (
    <div className={className}>
      <h1 className={cx('m-0 font-display text-title font-semibold tracking-[-0.02em]', titleClassName)}>{title}</h1>
      {sub && <p className="mt-[3px] mb-0 text-sub text-mute">{sub}</p>}
    </div>
  )
}

/** Section heading (`.h2`, 16 px / 800). */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('m-0 text-section font-extrabold', className)}>{children}</h2>
}

/** Small uppercase group label, e.g. "Today" and "Earlier" in notifications. */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cx('m-0 text-[13px] font-extrabold tracking-[0.5px] text-mute uppercase', className)}>{children}</h2>
  )
}

/** A heading row with an action link on the right ("Recent orders · View all"). */
export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-2.5', className)}>
      <SectionTitle>{title}</SectionTitle>
      {action}
    </div>
  )
}

/** The design's `.link`: bold blue text link. */
export function TextLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx('font-bold text-primary no-underline hover:text-primary-dark', className)}>
      {children}
    </Link>
  )
}

/** Label and value on one line (`.kv`): muted label left, bold value right. */
export function KeyValue({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cx('mo-kv', className)}>
      <span className="text-mute">{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  )
}

/** Thin divider (`.sep`). */
export function Separator({ className }: { className?: string }) {
  return <div role="presentation" className={cx('my-2 h-px bg-line', className)} />
}

/** Tinted square behind an icon (`.ico` with `.i-blue`, `.i-green`...). */
export type IconBadgeTone = 'blue' | 'green' | 'gold' | 'violet' | 'red' | 'teal'

const BADGE: Record<IconBadgeTone, string> = {
  blue: 'bg-sky text-primary',
  green: 'bg-green-bg text-green',
  gold: 'bg-gold-tint text-gold-icon',
  violet: 'bg-violet-bg text-violet',
  red: 'bg-red-bg text-red',
  teal: 'bg-teal-bg text-teal-ink',
}

export function IconBadge({
  tone,
  size = 40,
  radius = 12,
  className,
  children,
}: {
  tone: IconBadgeTone
  size?: number
  radius?: number
  className?: string
  children: ReactNode
}) {
  return (
    <span
      aria-hidden="true"
      className={cx('flex shrink-0 items-center justify-center', BADGE[tone], className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {children}
    </span>
  )
}

const TILE = 'mo-tile hover:text-ink'

/** Quick-action tile (`.tile`): icon badge over a short bold label. A link (`to`) or a button (`onClick`). */
export function ActionTile({
  to,
  onClick,
  icon,
  label,
  className,
}: {
  to?: string
  onClick?: () => void
  icon: ReactNode
  label: ReactNode
  className?: string
}) {
  if (to) {
    return (
      <Link to={to} className={cx(TILE, className)}>
        {icon}
        {label}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cx(TILE, 'font-[inherit]', className)}>
      {icon}
      {label}
    </button>
  )
}

/**
 * Drawer menu row (`.mi`): 50 px tall, icon then label, optional trailing
 * badge. A link (`to`) or, for an action like "Install the app", a button
 * (`onClick`).
 */
export function MenuItem({
  to,
  onClick,
  icon,
  children,
  trailing,
  current = false,
  tone = 'blue',
  className,
  style,
}: {
  to?: string
  onClick?: () => void
  icon: ReactNode
  children: ReactNode
  trailing?: ReactNode
  /** The page you are on: tinted background, bold blue text (`aria-current`). */
  current?: boolean
  /** Colour of the current row: blue, or green in the tanker driver app (`t-menu`). */
  tone?: 'blue' | 'green'
  className?: string
  style?: CSSProperties
}) {
  const body = (
    <>
      <span className={cx('flex shrink-0', !current ? 'text-gray' : tone === 'green' ? 'text-[#14532D]' : 'text-primary')}>{icon}</span>
      {children}
      {trailing && <span className="ml-auto">{trailing}</span>}
    </>
  )
  if (!to) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={style}
        className={cx('mo-mi w-full cursor-pointer border-0 bg-transparent text-left hover:text-ink', className)}
      >
        {body}
      </button>
    )
  }
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      style={style}
      className={cx(
        'mo-mi',
        current && tone === 'blue' && 'bg-sky font-extrabold text-primary-dark hover:text-primary-dark',
        current && tone === 'green' && 'bg-[#E7F7EE] font-extrabold text-[#14532D] hover:text-[#14532D]',
        !current && 'hover:text-ink',
        className,
      )}
    >
      {body}
    </Link>
  )
}

/** Progress segments at the top of a multi-step flow (4 bars, done ones blue). */
export function StepBar({ total, done, className }: { total: number; done: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('grid gap-1.5', className)}
      style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx('h-[5px] rounded-[3px]', i < done ? 'bg-primary' : 'bg-[#DCE5F0]')} />
      ))}
    </div>
  )
}

/** Count badge in a red circle (menu "Notifications 2"). */
export function CountBadge({ count, label }: { count: number; label?: string }) {
  return (
    <span
      aria-label={label}
      className="flex size-[22px] items-center justify-center rounded-full bg-[#DC2626] text-chip font-extrabold text-white"
    >
      {count}
    </span>
  )
}
