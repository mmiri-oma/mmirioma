import { SignInPage } from '../../auth/pages/SignInPage'
import { ORDER_TEXT } from '../messages'
import { useRequestDraftStore } from '../requestDraft'

/**
 * Customer sign in (C3). When the session ended while a request was being
 * typed, the X2 banner adds "Your request has not been sent. What you typed
 * is kept." After signing in, the guard returns to Request water, which
 * reopens the kept draft (customer design Decision 10).
 */
export function CustomerSignInPage() {
  const store = useRequestDraftStore()
  return (
    <SignInPage
      app="customer"
      sessionEndedDetail={store.hasDraft() ? ORDER_TEXT.draftKept : undefined}
    />
  )
}
