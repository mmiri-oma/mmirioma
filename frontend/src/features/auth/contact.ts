/**
 * Customer support contacts (C1 "Need help? Call or WhatsApp us", C3
 * "Forgot your password? Contact us").
 *
 * The real pilot numbers are an open question (docs/design/authentication.md),
 * so they come from public build-time settings and are absent until set. The
 * screens hide the buttons rather than show a made-up number.
 */

export interface SupportContact {
  /** `tel:` link, or null when not configured. */
  callHref: string | null
  /** `https://wa.me/...` link, or null when not configured. */
  whatsAppHref: string | null
}

/**
 * Build contact links from raw settings.
 *
 * @param phone - Number to call, any format with digits and an optional `+`.
 * @param whatsApp - WhatsApp number in international form.
 * @returns Links for each configured contact.
 */
export function buildSupportContact(
  phone: string | undefined,
  whatsApp: string | undefined,
): SupportContact {
  const callDigits = phone?.replace(/[^\d+]/g, '') ?? ''
  const whatsAppDigits = whatsApp?.replace(/\D/g, '') ?? ''
  return {
    callHref: callDigits ? `tel:${callDigits}` : null,
    whatsAppHref: whatsAppDigits ? `https://wa.me/${whatsAppDigits}` : null,
  }
}

/** Support contacts from `VITE_SUPPORT_PHONE` and `VITE_SUPPORT_WHATSAPP`. */
export const supportContact = buildSupportContact(
  import.meta.env.VITE_SUPPORT_PHONE,
  import.meta.env.VITE_SUPPORT_WHATSAPP,
)
