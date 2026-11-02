/**
 * Copy for the public pages (design/MmiriOma-landing-handoff). Kept here so
 * the landing page, FAQ page and tests read the same words.
 *
 * Changed from the design (docs/design/landing-v1.md, "Differences"):
 * quality claims and promises the app does not keep (sealed cans, clean and
 * safe water, live tracking, picking a delivery time) are reworded or
 * removed, and the service areas are labelled as a sample list.
 */

/**
 * Support contacts. The email is the privacy notice's (section 16), the only
 * mailbox the pilot has; the design's `support@mmirioma.com` does not exist
 * (legal operator, #107).
 */
export const CONTACT = {
  email: 'olivetgrail@gmail.com',
  phoneHref: 'tel:+2348133774902',
  phoneLabel: '0813 377 4902',
  place: 'Enugu, Nigeria',
} as const

/** Label of every "order" button on the public pages (owner's choice, 2026-10-21). */
export const ORDER_CTA = 'Order Water'

/** Header and footer links: sections of the landing page, plus the FAQ page. */
export const NAV_LINKS: { label: string; to: string }[] = [
  { label: 'How it works', to: '/#how' },
  { label: 'Sizes', to: '/#sizes' },
  { label: 'For drivers', to: '/#drivers' },
  { label: 'Areas', to: '/#areas' },
  { label: 'FAQs', to: '/faq' },
]

/** Planned areas from the design. A sample until the pilot zone is confirmed (PRD §13.1, decision Q5). */
export const SERVICE_AREAS = [
  'GRA',
  'Ogui',
  'Independence Layout',
  'Trans-Ekulu',
  'Abakpa',
  'New Haven',
  'Thinkers Corner',
  'Anyika',
  'Emene',
  'Uwani',
  'and nearby areas',
]

/** The named areas only: the list ends with "and nearby areas", which is not a place. */
export const AREA_NAMES = SERVICE_AREAS.filter((a) => a !== 'and nearby areas')

export const FAQ_CATEGORIES = ['Ordering', 'Delivery', 'Delivery code', 'Payments', 'Riders & drivers', 'Account & safety'] as const
export type FaqCategory = (typeof FAQ_CATEGORIES)[number]

export interface Faq {
  cat: FaqCategory
  q: string
  a: string
}

/** The FAQ page's questions (content/faqs.json, with the changes listed above). */
export const FAQS: Faq[] = [
  {
    cat: 'Ordering',
    q: 'How do I place an order?',
    a: 'Open the customer app, choose Keke or Tanker, pick your size and quantity, then confirm your delivery address. Our team then calls you to agree the delivery window, and the price if the app could not show one, before we confirm your order.',
  },
  {
    cat: 'Ordering',
    q: 'What is the difference between Keke and Tanker delivery?',
    a: 'Keke delivery is for smaller orders. The rider brings our 25 or 50 litre cans, pours them into your drums or containers and takes the empty cans back for refill. Tanker delivery is for bulk orders of 500 gallons and above, pumped straight into your ground or overhead tank.',
  },
  {
    cat: 'Ordering',
    q: 'Can I order a custom tanker quantity?',
    a: 'Yes. Choose Custom Size under Available Capacities and enter the quantity you need. We will confirm availability and price in the app.',
  },
  {
    cat: 'Delivery',
    q: 'Do you pour the water for tanker deliveries?',
    a: 'Yes. Tell us whether you have a ground or overhead tank when you order, and the driver will pump the water straight into it.',
  },
  {
    cat: 'Delivery',
    q: 'How long does delivery take?',
    a: 'We agree a delivery window with you on the confirmation call. The app then shows each step of your delivery.',
  },
  {
    cat: 'Delivery',
    q: 'Which areas do you deliver to?',
    a: 'We are confirming our first service areas in Enugu. The areas on our home page are a sample list for now. Contact us to check yours.',
  },
  {
    cat: 'Delivery',
    q: 'What if I am not at home when the rider arrives?',
    a: 'Share your delivery code with someone you trust at the gate, like a family member or gateman, so they can receive the water for you.',
  },
  {
    cat: 'Delivery code',
    q: 'How do I receive my delivery code (OTP)?',
    a: 'We send it by SMS to the order’s contact number when the rider or driver has finished unloading. It is valid for a short time only and is unique to that order.',
  },
  {
    cat: 'Delivery code',
    q: 'When should I give the rider my code?',
    a: 'Only after the full quantity has been poured into your containers or tank. Giving the code confirms the delivery is complete.',
  },
  {
    cat: 'Delivery code',
    q: 'What if something is wrong with my delivery?',
    a: 'Do not share your code. Report the problem in the app straight away and our support team will sort it out.',
  },
  {
    cat: 'Payments',
    q: 'What payment methods do you accept?',
    a: 'During the pilot you pay in cash on delivery, to the rider or driver, after the water has been unloaded. The app does not take card or online payments.',
  },
  {
    cat: 'Payments',
    q: 'Can I get a refund?',
    a: 'Contact us, for example if a delivery was short. Our team reviews each request, and any refund we approve is paid to you outside the app, for example by bank transfer.',
  },
  {
    cat: 'Riders & drivers',
    q: 'How do I become a rider or driver?',
    a: 'Sign up in the driver app with your vehicle type, plate number and the tank capacity you carry, then wait for our team to check your vehicle and approve you. Once approved, go online and start accepting jobs.',
  },
  {
    cat: 'Riders & drivers',
    q: 'Can I use my own keke or tanker?',
    a: 'Yes. Tell us your vehicle type when you apply. Our team checks the vehicle as part of approval.',
  },
  {
    cat: 'Riders & drivers',
    q: 'How do I get paid?',
    a: 'During the pilot the driver app does not show earnings or make payments. How you are paid is agreed with our team outside the app.',
  },
  {
    cat: 'Account & safety',
    q: 'Where does your water come from?',
    a: 'From water sources our team has checked and approved. Each order states its water category, Potable Water or Utility Water, and only Potable Water is described as drinking water. Please keep your own drums and tanks clean and covered, because the water’s condition after delivery also depends on them.',
  },
  {
    cat: 'Account & safety',
    q: 'Do I need to download the app from an app store?',
    a: 'No. Waterline is a web app. Open the link on your phone or computer and add it to your home screen with the Install button (on iPhone: Share, then Add to Home Screen).',
  },
]

/** The landing page's questions, in the design's shorter wording. "Not at home" moved to OBJECTIONS. */
export const LANDING_FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I place an order?',
    a: "Open the customer app, choose Keke or Tanker, pick your size and quantity, then confirm your delivery address. Our team calls you to agree the delivery window before we confirm.",
  },
  {
    q: 'What is the difference between Keke and Tanker delivery?',
    a: 'Keke delivery is for smaller orders. The rider brings our cans, pours them into your drums or containers and takes the empty cans back. Tanker delivery is for bulk orders and pumps straight into your tank.',
  },
  {
    q: 'Do you pour the water for tanker deliveries?',
    a: 'Yes. Tell us whether you have a ground or overhead tank when you order, and the driver will pump the water straight into it.',
  },
  {
    q: 'How do I receive my delivery code (OTP)?',
    a: 'We send it by SMS when the rider or driver has finished unloading. Only give it after your water has been poured.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'During the pilot you pay in cash on delivery, after the water has been unloaded.',
  },
  {
    q: 'Can I order a custom tanker quantity?',
    a: 'Yes. Choose Custom Size and enter the quantity you need. We will confirm availability and price in the app.',
  },
  {
    q: 'How do I become a rider or driver?',
    a: 'Sign up in the driver app with your vehicle details and wait for our team to check your vehicle and approve you. Once approved, go online and start accepting jobs.',
  },
]

/**
 * The worries people have before a first order, answered right above the
 * landing page's closing button. Every answer restates a rule the app keeps:
 * refunds reviewed by our team (FAQ "Can I get a refund?"), the order keeps its quote
 * (FR-024), custom tanker sizes priced by the team (FR-021), the delivery code
 * (FAQ "Delivery code"), and the sample areas list (decision Q5).
 */
export const OBJECTIONS: { q: string; a: string }[] = [
  {
    q: 'What if I get less water than I paid for?',
    a: 'Do not give your delivery code. Call us or report it in the app, and our team will sort it out with you.',
  },
  {
    q: 'Can the price change after I order?',
    a: 'No. You see the full price before you confirm, and your order keeps it. Custom tanker sizes get a price from our team first.',
  },
  {
    q: "What if I'm not at home?",
    a: 'Give your delivery code to someone you trust at the gate. They can receive the water for you.',
  },
  {
    q: 'Do you deliver to my area?',
    a: 'We are confirming our first areas in Enugu. Ask us on WhatsApp before you order.',
  },
]

export type FaqFilter = FaqCategory | 'All'

/** True when `search` appears in the question or answer (case-insensitive). Empty search matches all. */
function matches(faq: Faq, search: string): boolean {
  const s = search.trim().toLowerCase()
  return s === '' || faq.q.toLowerCase().includes(s) || faq.a.toLowerCase().includes(s)
}

/**
 * The FAQ page's list and category counts for a search and category.
 * Counts follow the search, so a category shows how many of its questions match.
 */
export function filterFaqs(search: string, category: FaqFilter, faqs: Faq[] = FAQS) {
  const found = faqs.filter((f) => matches(f, search))
  const counts = { All: found.length } as Record<FaqFilter, number>
  for (const c of FAQ_CATEGORIES) counts[c] = found.filter((f) => f.cat === c).length
  return { list: category === 'All' ? found : found.filter((f) => f.cat === category), counts }
}
