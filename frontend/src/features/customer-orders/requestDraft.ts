import { createContext, useContext, useEffect } from 'react'
import { useSession } from '../auth/sessionContext'
import type { RequestFormValues } from './requestForm'

/** An unsent "Request water" form (O2). */
export interface RequestDraft {
  /** Account that typed it; another account never sees it. */
  ownerId: string
  values: RequestFormValues
  /**
   * Made once when the form first opens and kept until the server gives a
   * definite answer (customer design Decision 9; FR-026, T-06).
   */
  idempotencyKey: string
}

/**
 * Holds the unsent request in app memory (customer design Decision 10).
 *
 * The address and phone are personal data, so they are never written to
 * `localStorage`, `sessionStorage` or cookies. The draft survives the form
 * being closed, including the session ending while the app is open (X2: after
 * signing in again the form reopens filled in, with the same idempotency
 * key). It is cleared when the request is sent or found to exist already,
 * and when the person signs out. A page reload loses it (accepted for this
 * release).
 *
 * Saving does not re-render anything: the form reads the draft only when it
 * opens.
 */
export interface RequestDraftStore {
  /** The draft for `ownerId`, or null if there is none or it is another account's. */
  read(ownerId: string): RequestDraft | null
  /** True when any unsent draft exists (for the X2 "What you typed is kept" line). */
  hasDraft(): boolean
  save(draft: RequestDraft): void
  clear(): void
}

/** Create an empty draft store. */
export function createRequestDraftStore(): RequestDraftStore {
  let draft: RequestDraft | null = null
  return {
    read: (ownerId) => (draft !== null && draft.ownerId === ownerId ? draft : null),
    hasDraft: () => draft !== null,
    save: (next) => {
      draft = next
    },
    clear: () => {
      draft = null
    },
  }
}

/**
 * The app's draft store. A context (rather than a module import) so tests
 * can give each render a fresh store.
 */
export const RequestDraftContext = createContext<RequestDraftStore>(createRequestDraftStore())

/** The request draft store for the current tree. */
export function useRequestDraftStore(): RequestDraftStore {
  return useContext(RequestDraftContext)
}

/**
 * Clear the draft when the person chooses to sign out (Decision 10), so the
 * next person on a shared phone never sees it. A session that merely ended
 * (X2) keeps it. Rendered once, next to the route table.
 */
export function RequestDraftSignOutSync() {
  const { status } = useSession()
  const store = useRequestDraftStore()
  const signedOutByUser = status.kind === 'signed-out' && status.byUser

  // Runs when the session status changes to "signed out by the user".
  useEffect(() => {
    if (signedOutByUser) store.clear()
  }, [signedOutByUser, store])

  return null
}
