import { useCallback, useState } from 'react'
import { bannerForError, type AuthBanner } from './messages'

/**
 * Banner state shared by the sign-in and create-account forms.
 *
 * Each failure gets a new `key`, so a repeated rate limit restarts its wait
 * line. While a rate limit lasts, `waiting` is true and the submit button is
 * off (Decision 3); the wait line calls `onWaitOver` to turn it back on.
 */
export function useAuthFormBanner() {
  const [state, setState] = useState<{
    banner: AuthBanner | null
    key: number
    waiting: boolean
  }>({ banner: null, key: 0, waiting: false })

  const showError = useCallback((error: unknown) => {
    const banner = bannerForError(error)
    setState((previous) => ({
      banner,
      key: previous.key + 1,
      waiting: banner.waitSeconds !== undefined,
    }))
  }, [])
  const clear = useCallback(
    () => setState((previous) => ({ ...previous, banner: null, waiting: false })),
    [],
  )
  const onWaitOver = useCallback(
    () => setState((previous) => ({ ...previous, waiting: false })),
    [],
  )

  return {
    banner: state.banner,
    bannerKey: state.key,
    waiting: state.waiting,
    showError,
    clear,
    onWaitOver,
  }
}
