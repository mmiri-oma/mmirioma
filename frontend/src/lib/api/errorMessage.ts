import { ApiError } from './client'

/** Human message for an error: the backend's message, or plain words for network problems. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return 'We cannot reach Waterline right now. Check your data connection and try again.'
    return error.message
  }
  return 'Something went wrong. Please try again.'
}
