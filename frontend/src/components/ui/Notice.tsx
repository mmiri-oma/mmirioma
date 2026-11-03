import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { AlertCircleIcon, CheckIcon } from '../icons/icons'

const TONE = {
  /** The design's note box on `c-save` ("You can edit or remove saved addresses..."). */
  note: { box: 'bg-[#FFF7E2] text-[#5A4310]', icon: '#C27C00' },
  error: { box: 'bg-red-bg text-red', icon: '#B91C1C' },
  success: { box: 'bg-green-bg text-green', icon: '#15803D' },
  info: { box: 'bg-sky text-primary-dark', icon: '#11708C' },
} as const

/**
 * Rounded message box with an icon. Errors use `role="alert"` so screen
 * readers announce them; other tones use `role="status"`.
 */
export function Notice({
  tone = 'note',
  children,
  className,
}: {
  tone?: keyof typeof TONE
  children: ReactNode
  className?: string
}) {
  const t = TONE[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('mo-notice', t.box, className)}
    >
      {tone === 'success' ? (
        <CheckIcon size={20} color={t.icon} strokeWidth={2.4} className="shrink-0" />
      ) : (
        <AlertCircleIcon size={20} color={t.icon} roundJoin={false} className="shrink-0" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
