/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** Public support phone number for customers, e.g. `08000000001`. */
  readonly VITE_SUPPORT_PHONE?: string
  /** Public support WhatsApp number in international form, e.g. `2348000000001`. */
  readonly VITE_SUPPORT_WHATSAPP?: string
  /** `api` or `mock`: data for the customer and staff order screens (default: api; mock in tests). */
  readonly VITE_ORDERS_SOURCE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
