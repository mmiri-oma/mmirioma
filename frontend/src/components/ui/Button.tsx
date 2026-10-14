import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonVariants'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. `primary` is for the one main action on a screen. */
  variant?: ButtonVariant
  size?: ButtonSize
}

/** Standard button. Defaults to `type="button"` so it never submits a form by accident. */
export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonClasses(variant, size), className)} {...props} />
}
