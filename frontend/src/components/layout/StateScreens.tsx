import type { ReactNode } from 'react'
import { errorMessage } from '../../lib/api/errorMessage'
import { Illustration } from '../brand/Illustration'
import { AlertCircleIcon } from '../icons/icons'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { MobileShell, ScrollArea, TopBar } from './MobileShell'

/** Inline loading block: card-shaped placeholders with a light sweep moving across them. */
export function LoadingBlock({ label = 'Loading', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} aria-hidden="true" className="skeleton h-[72px] rounded-card border border-card-line bg-[#F4F8FD]" />
      ))}
    </div>
  )
}

/** Inline error card with a retry button (NFR-012: clear guidance). */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card pad role="alert" className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 text-red">
        <AlertCircleIcon size={20} />
        <p className="m-0 font-bold">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="alt" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  )
}

/** Empty state: illustration, title, short text and an optional action. */
export function EmptyBlock({
  title,
  text,
  action,
  illustration = 'jerrycan',
}: {
  title: string
  text?: string
  action?: ReactNode
  illustration?: 'jerrycan' | 'keke' | 'tanker' | 'gift'
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Illustration name={illustration} className="animate-float h-20 w-auto" />
      <p className="m-0 text-section font-extrabold">{title}</p>
      {text && <p className="m-0 max-w-[280px] text-sub text-mute">{text}</p>}
      {action && <div className="mt-2 w-full">{action}</div>}
    </div>
  )
}

/**
 * Animated water drop with a ripple, for loading a whole screen. The label is
 * read by screen readers; the animation stops under reduced motion.
 */
export function WaterLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
      <span className="relative flex size-16 items-center justify-center" aria-hidden="true">
        <span className="animate-ping absolute inset-2 rounded-full bg-[rgba(17,112,140,.25)] [animation-duration:1.6s]" />
        <svg width="38" height="38" viewBox="0 0 24 24" className="animate-drop-bob relative text-primary">
          <path fill="currentColor" d="M12 2.5s-7 7.6-7 12.2a7 7 0 0 0 14 0C19 10.1 12 2.5 12 2.5Z" />
          <path fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" d="M9 15.5a3 3 0 0 0 3 3" opacity=".8" />
        </svg>
      </span>
      <span className="text-sub font-bold text-mute">{label}</span>
    </div>
  )
}

/** Full-screen loading state while the session is checked or the first page loads. */
export function LoadingScreen() {
  return (
    <MobileShell>
      <TopBar />
      <ScrollArea className="items-center justify-center">
        <WaterLoader />
      </ScrollArea>
    </MobileShell>
  )
}

/** Full-screen error with retry. */
export function ErrorScreen({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <MobileShell>
      <TopBar />
      <ScrollArea>
        <ErrorBlock error={error} onRetry={onRetry} />
      </ScrollArea>
    </MobileShell>
  )
}
