import { useEffect, useState } from 'react'
import { useNavigation } from 'react-router-dom'

/** Wait this long before showing the bar, so quick page changes do not flash it. */
const SHOW_AFTER_MS = 150

/**
 * Thin animated bar along the top edge while the next page is loading (its
 * code chunk downloading, see router.tsx). The page being left stays on
 * screen and usable until the new one is ready, so this is the only sign that
 * the tap worked.
 */
export function RouteProgress() {
  const loading = useNavigation().state === 'loading'
  const [visible, setVisible] = useState(false)

  // Show only if loading lasts longer than SHOW_AFTER_MS; the timer is
  // cleared when loading ends first, and the bar hides as soon as it ends.
  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS)
    return () => {
      window.clearTimeout(timer)
      setVisible(false)
    }
  }, [loading])

  if (!loading || !visible) return null
  return (
    <div role="progressbar" aria-label="Loading page" className="fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden bg-[rgba(17,112,140,.15)]">
      <div className="animate-progress h-full w-2/5 rounded-r-[3px] bg-primary" />
    </div>
  )
}
