import { useEffect, useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import type { AuthBanner, BannerAction } from '../messages'
import { formatWait } from '../waitTime'

const ACTION_LABEL: Record<BannerAction, string> = {
  retry: 'Retry',
  'sign-in-instead': 'Sign in instead',
  reload: 'Reload',
}

export interface AuthBannerViewProps {
  banner: AuthBanner
  /** Called when the banner's action button is pressed. */
  onAction?: (action: BannerAction) => void
  /** Second line under the title (e.g. the X2 customer "request kept" line). */
  detail?: string
  /** For rate limits: called once when the wait is over. */
  onWaitOver?: () => void
}

/** Renders an {@link AuthBanner} with the design system's alert. */
export function AuthBannerView({
  banner,
  onAction,
  detail,
  onWaitOver,
}: AuthBannerViewProps) {
  const tone =
    banner.tone === 'warning' ? 'warning' : banner.tone === 'info' ? 'info' : 'error'
  return (
    <Alert
      tone={tone}
      title={banner.title}
      action={
        banner.action && onAction ? (
          <Button
            variant="secondary"
            onClick={() => onAction(banner.action as BannerAction)}
          >
            {ACTION_LABEL[banner.action]}
          </Button>
        ) : undefined
      }
    >
      {banner.waitSeconds !== undefined ? (
        <WaitLine seconds={banner.waitSeconds} onWaitOver={onWaitOver} />
      ) : detail ? (
        <p className="font-semibold">{detail}</p>
      ) : null}
    </Alert>
  )
}

/**
 * "Try again in N minutes", updated as time passes (Decision 8). Tells the
 * parent when the wait is over so it can turn the submit button back on.
 */
function WaitLine({ seconds, onWaitOver }: { seconds: number; onWaitOver?: () => void }) {
  const remaining = useRemainingSeconds(seconds)
  const over = remaining <= 0

  // Notify the form once, when the wait reaches zero.
  useEffect(() => {
    if (over) onWaitOver?.()
  }, [over, onWaitOver])

  if (over) return null
  return <p className="font-semibold">{formatWait(remaining)}</p>
}

/**
 * Seconds left of a wait that started when this hook first ran. Ticks once a
 * second through a timer that is cleared on unmount.
 *
 * @param seconds - Length of the wait.
 * @returns Seconds remaining, never below zero.
 */
function useRemainingSeconds(seconds: number): number {
  const [deadline] = useState(() => Date.now() + seconds * 1000)
  const [now, setNow] = useState(() => Date.now())
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const waiting = remaining > 0

  // Subscribe to the clock until the wait is over.
  useEffect(() => {
    if (!waiting) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [waiting])

  return remaining
}
