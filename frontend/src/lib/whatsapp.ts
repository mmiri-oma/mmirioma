/**
 * Company WhatsApp chat links.
 *
 * The support number and whether WhatsApp is on come from the backend's one
 * configuration value (`GET /public/contact`, FR-055, docs/api/public-site.md).
 * The official number below is used only while the website cannot read it.
 */

/** The official support number (SRS FR-055), E.164. Fallback only; the server's value wins. */
export const DEFAULT_SUPPORT_PHONE = '+2348133774902'

/** WhatsApp is confirmed active on the support number (#8), so the fallback chats there too. */
export const DEFAULT_WHATSAPP = DEFAULT_SUPPORT_PHONE

/** The greeting already typed in the chat when someone taps the button. */
export const WHATSAPP_GREETING = "Hello Waterline, I'd like to order water."

/**
 * A `https://wa.me/` link that opens a chat with `e164` in the WhatsApp app
 * (or WhatsApp Web), with `text` typed in. wa.me wants the number as digits
 * only, without `+`.
 *
 * @param e164 - Number like `+2348133774902`; falls back to the default when null.
 * @param text - Message to prefill; omit for an empty chat.
 */
export function whatsappLink(e164: string | null, text?: string): string {
  const digits = (e164 ?? DEFAULT_WHATSAPP).replace(/\D/g, '')
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`
}
