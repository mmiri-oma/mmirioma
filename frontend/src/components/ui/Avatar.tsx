import type { CSSProperties } from 'react'
import { cx } from '../../lib/cx'
import { initials } from '../../lib/initials'

interface AvatarProps {
  /** Person's name; the avatar shows their initials. */
  name: string
  /** Diameter in px. Design sizes: 42 (top bar), 38 (lists), 56 (menu). */
  size?: number
  /** Font size in px; defaults to a third of the size, as in the design. */
  fontSize?: number
  className?: string
  style?: CSSProperties
  /** Profile photo; when set it replaces the initials. */
  photoUrl?: string | null
  /**
   * `brand` is the blue-teal staff/self avatar; `green` the green-teal one of
   * the tanker driver app (`t-*`); `plain` the grey one used for customers on
   * partner screens.
   */
  tone?: 'brand' | 'green' | 'plain'
}

/**
 * The design's `.av`: blue-to-teal gradient circle with white initials and a
 * light blue outer ring. Decorative: the name is always shown next to it.
 */
export function Avatar({ name, size = 42, fontSize, className, style, photoUrl, tone = 'brand' }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white font-extrabold',
        tone === 'brand' && 'bg-[linear-gradient(135deg,#11708C,#16A0B8)] text-white shadow-[0_0_0_2px_#CFE2FB]',
        tone === 'green' && 'bg-[linear-gradient(135deg,#15803D,#16A0B8)] text-white shadow-[0_0_0_2px_#CFE2FB]',
        tone === 'plain' && 'bg-line text-ink',
        className,
      )}
      style={{ width: size, height: size, fontSize: fontSize ?? Math.round(size / 3), ...style }}
    >
      {photoUrl ? <img src={photoUrl} alt="" className="size-full rounded-full object-cover" /> : initials(name)}
    </span>
  )
}
