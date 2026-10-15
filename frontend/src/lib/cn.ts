/**
 * Join conditional class names, skipping falsy values.
 *
 * A dependency-free stand-in for `clsx`. It does not merge conflicting
 * Tailwind classes, so components put caller `className` last and avoid
 * passing conflicting utilities.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
