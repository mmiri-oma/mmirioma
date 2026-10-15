/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** Public support phone number for customers, e.g. `08000000001`. */
  readonly VITE_SUPPORT_PHONE?: string
  /** Public support WhatsApp number in international form, e.g. `2348000000001`. */
  readonly VITE_SUPPORT_WHATSAPP?: string
  /** `api` or `mock`: data for the admin order screens (default: api in production builds, mock in dev). */
  readonly VITE_ADMIN_ORDERS_SOURCE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
