/**
 * Seed data for mock mode. Names, places and orders are the SAMPLE records
 * drawn in the design handoff. Phone numbers use the reserved-looking
 * 0803 123 4567 style from the design and are not real people.
 *
 * Demo sign-in (mock mode only, never a real credential), password DEMO_PASSWORD:
 *   customer      phone 0803 123 4567
 *   admin         phone 0800 000 0100   (adminSeed.ts)
 *   Keke rider    phone 0800 000 0101   (partnerSeed.ts)
 *   Tanker driver phone 0800 000 0102   (partnerSeed.ts)
 */
import type { User } from '../lib/api/auth'
import type { AdminOrderHold } from '../domain/admin'
import { describeChoice } from '../domain/orders'
import type {
  CustomerNotification,
  CustomerOrder,
  CustomerProfile,
  PaymentMethod,
  PaymentStatus,
  PointsEntry,
  Quote,
  SavedAddress,
  SupportTicket,
  WaterChoice,
} from '../domain/orders'
import type {
  EarningEntry,
  JobPlace,
  JobStage,
  PartnerJob,
  PartnerNotification,
  PartnerProfile,
  PayoutEntry,
} from '../domain/partner'
import { ADMIN_NAME, DEMO_ADMIN_ID, seedAdmin, type AdminData } from './adminSeed'
import { DEMO_DRIVER_ID, DEMO_RIDER_ID, seedPartners } from './partnerSeed'
import { ANY_PLACE, quoteFor } from './pricing'
import { lagosAt as lagos, lagosToday } from './time'

export const DEMO_PASSWORD = 'mmirioma-demo'
/** Demo staff phone, for the mock-only "Use demo staff account" button on the staff sign-in. */
export const DEMO_ADMIN_PHONE = '0800 000 0100'

export interface MockUser extends User {
  password: string
}

/**
 * A customer order as the mock stores it. The mock always knows the choice,
 * the full sample quote, the address label and the payment status, so those
 * are never `null` here; screens get the wider `CustomerOrder`, which also
 * fits the real API.
 */
export interface MockCustomerOrder extends CustomerOrder {
  choice: WaterChoice
  address_label: string
  payment: { method: PaymentMethod; status: PaymentStatus }
  quote: Extract<Quote, { status: 'quote_available' }>
}

export interface CustomerData {
  /** The mock always offers email and the switches, so they are never absent or `null` here. */
  profile: { email: string | null; customer_since: string; photo_url: string | null; preferences: NonNullable<CustomerProfile['preferences']> }
  addresses: SavedAddress[]
  orders: MockCustomerOrder[]
  notifications: CustomerNotification[]
  points: { balance: number; history: PointsEntry[] }
  tickets: SupportTicket[]
}

/**
 * A job in the shared pool, with the server-side fields partners never see.
 * The mock always knows the customer's choice, a sample rider pay, both
 * addresses, the receiver and the code tries, so those are never `null`
 * here (mock mode keeps every value, @chidimmamogbo on #12).
 */
/**
 * A held job's hold in the mock: what the admin order carries (`id`, `kind`,
 * `since`) plus what the driver reported, which the history shows ("Hold
 * opened") and the review sheet will read. The note is SAMPLE text.
 */
export type MockHold = AdminOrderHold & {
  /** The exception category the hold opened with (deliveries.md, "Event object"). */
  category: 'alternative_proof' | 'source_mismatch' | 'pickup_safety_concern' | 'unsafe_access'
  driver_note: string
}

export interface StoredJob extends PartnerJob {
  choice: WaterChoice
  earning_minor_units: number
  station: JobPlace & { address: string }
  customer: JobPlace & { address: string; contact_name: string; phone: string }
  /**
   * The mocks never dispute a job (`under_review`). An administrator can fail
   * one, from a held job or an accepted one (admin-hold-review.md, FAIL).
   */
  stage: Exclude<JobStage, 'under_review'>
  /** Staff only (admin screens); partners never see it (FR-040, BR-13). */
  payment_status: PaymentStatus
  /** Partner who has (or is assigned) the job. */
  partner_id: string | null
  /** Partners who declined it, so it is not offered to them again. */
  declined_by: string[]
  /** Delivery code for seeded jobs with no customer order (mock only). */
  mock_code: string | null
  /** Mock only: the code has expired, so `verifyCode` answers `delivery_code_expired` (#138). */
  mock_code_expired?: boolean
  /** Mock only: the partner pressed "Start unloading" (#250). The backend has the order status `unloading` for this. */
  mock_unloading_started?: boolean
  /**
   * The job's open hold (docs/api/deliveries.md, "Admin hold review
   * endpoints"): it stops the job and shows on the admin order. A hold is not
   * a stage. Admin decisions clear it.
   */
  hold?: MockHold | null
  /** The hold that was open before an administrator decided it, so the history still shows how it opened. */
  past_hold?: MockHold | null
  /** Set when an administrator withdrew the job (the driver, when, the note): the hold closed with it, and the history shows the withdraw. */
  withdrawn?: { driver: string; at: string; note: string | null } | null
  /** Set when an administrator failed or cancelled the job from the admin screens: why, who, when, for the history. Any open hold closed with it. */
  ended?: { kind: 'failed' | 'cancelled'; reason_code: string; note: string | null; by: string; at: string } | null
  /** The decision on `past_hold` (who, when, the note), for the history and the decided card. */
  hold_decision?: { decision: 'proof_approved' | 'proof_rejected' | 'source_continued' | 'unsafe_resumed'; by: string; at: string; note: string } | null
  /** When the order was placed (admin lists). */
  created_at: string
}

export interface PartnerIssue {
  id: string
  type: string
  note: string
  reference: string | null
  at: string
}

export interface PartnerData {
  profile: Omit<PartnerProfile, 'name' | 'phone'>
  /** Short fleet code for admin tables and the map, e.g. KK-014, TK-102. */
  fleet_code: string
  rating: number | null
  wallet_minor_units: number
  /** Sample pay for the last 7 days, oldest first. */
  week: number[]
  today_minor_units: number
  deliveries_today: number
  earnings: EarningEntry[]
  payouts: PayoutEntry[]
  notifications: PartnerNotification[]
  issues: PartnerIssue[]
}

export interface MockPushSubscription {
  /** Opted in to "New order near you" (partners only; off by default). */
  new_orders: boolean
  created_at: string
}

export interface MockState {
  users: MockUser[]
  /** Signed-in user id for this browser (one session cookie per browser, as with the real API). */
  sessionUserId: string | null
  /** When the session ends: 7 days after sign-in, no sliding renewal (auth.md). */
  sessionExpiresAt: string | null
  /** Users who turned on push notifications in this browser, by user id (push.md, mock only). */
  pushSubscriptions: Record<string, MockPushSubscription>
  customers: Record<string, CustomerData>
  partners: Record<string, PartnerData>
  /** Shared job pool: every order partners can see or have done. */
  jobs: StoredJob[]
  /** Admin-only records (stations, prices, issues, audit...). */
  admin: AdminData
  /**
   * The open SMS code per user (auth.md, phone verification), mock only.
   * Optional because data saved before phone verification does not have it.
   */
  phoneCodes?: Record<string, MockPhoneCode>
  /** When codes were sent, per phone number (E.164), for the hourly limit. */
  phoneCodeSends?: Record<string, string[]>
}

/** One SMS code: for the account's own phone, or for a new number (phone change). */
export interface MockPhoneCode {
  purpose: 'verify' | 'change'
  /** Where the code went, E.164. For a change, the new number. */
  phone: string
  code: string
  sent_at: string
  expires_at: string
  attempts_left: number
}

export const DEMO_CUSTOMER_ID = 'user-adaeze'

/**
 * A fresh customer for testing a first order: phone already verified (so the
 * SMS code step is skipped), no addresses, no orders. Signs in with
 * `DEMO_PASSWORD`. Mock mode only, like every account here.
 */
export const TEST_CUSTOMER_ID = 'user-test-customer'
/** The test customer's phone number, as people type it. */
export const TEST_CUSTOMER_PHONE = '0809 000 0101'

const CHINEDU = { name: 'Chinedu Okafor', vehicle: 'keke' as const, plate: 'ENU 482 KK', rating: 4.8, phone: '+2348000000101' }
const EMEKA = { name: 'Emeka David', vehicle: 'tanker' as const, plate: 'ENU 115 XA', rating: 4.7, phone: '+2348000000102' }

function kekeOrder(partial: Partial<MockCustomerOrder> & Pick<MockCustomerOrder, 'reference' | 'created_at' | 'stage'>, size: 25 | 50, count: number): MockCustomerOrder {
  const choice = { delivery_type: 'keke' as const, can_size_litres: size, can_count: count }
  const quote = quoteFor(choice, ANY_PLACE)
  if (quote.status !== 'quote_available') throw new Error('seed quote')
  return {
    choice,
    address_label: 'Home',
    address: '12 Lakeview Street, GRA, Enugu',
    landmark: 'Beside Parkview Hotel',
    receiver_name: 'Adaeze Nwosu',
    receiver_phone: '+2348031234567',
    instructions: null,
    payment: { method: 'pay_on_delivery', status: 'paid' },
    quote,
    partner: CHINEDU,
    station_name: 'GRA Refill Station',
    eta_minutes: null,
    delivery_code: null,
    timeline: [],
    delivery_window: null,
    delivered_at: null,
    delivered_quantity: null,
    points_earned: null,
    feedback: null,
    ...partial,
  }
}

export function seedState(now = new Date()): MockState {
  const activeCreated = lagosToday(10, 58, now)

  const tankerChoice = { delivery_type: 'tanker' as const, tank_type: 'overhead' as const, tank_size_gallons: 750 as const, source: 'borehole' as const }
  const tankerQuote = quoteFor(tankerChoice, ANY_PLACE)
  if (tankerQuote.status !== 'quote_available') throw new Error('seed quote')

  const orders: MockCustomerOrder[] = [
    kekeOrder(
      {
        reference: 'MO-7KQ2M9XH4T',
        created_at: activeCreated,
        stage: 'on_the_way',
        payment: { method: 'pay_on_delivery', status: 'unpaid' },
        // The window the dispatcher agreed, so the order detail's row shows in the demo.
        delivery_window: { start_at: lagosToday(10, 0, now), end_at: lagosToday(12, 0, now) },
        eta_minutes: 8,
        delivery_code: '482791',
        timeline: [
          { label: 'Order placed', at: activeCreated },
          { label: 'Chinedu Okafor accepted', at: lagosToday(11, 2, now), detail: 'Keke ENU 482 KK' },
          { label: 'Collected at GRA Refill Station', at: lagosToday(11, 20, now), detail: '600 L · 150 gal' },
        ],
      },
      25,
      24,
    ),
    {
      reference: 'MO-5KL2ZT8QWD',
      created_at: lagos('2026-10-02', 8, 10),
      choice: tankerChoice,
      address_label: 'Office',
      address: '4 Zik Avenue, Uwani, Enugu',
      landmark: 'Second gate, ask for the cashier',
      receiver_name: 'Adaeze Nwosu',
      receiver_phone: '+2348031234567',
      instructions: null,
      stage: 'delivered',
      payment: { method: 'bank_transfer', status: 'paid' },
      quote: tankerQuote,
      partner: EMEKA,
      station_name: 'Ogui Station',
      eta_minutes: null,
      delivery_code: null,
      timeline: [
        { label: 'Order placed', at: lagos('2026-10-02', 8, 10) },
        { label: 'Emeka David accepted', at: lagos('2026-10-02', 8, 14), detail: 'Tanker ENU 115 XA' },
        { label: 'Loaded at Ogui Station', at: lagos('2026-10-02', 8, 52), detail: '750 gal (3,000 L) confirmed' },
        { label: 'Delivered, code verified', at: lagos('2026-10-02', 9, 31), detail: 'On time' },
      ],
      delivery_window: null,
      delivered_at: lagos('2026-10-02', 9, 31),
      delivered_quantity: '750 gallons (3,000 litres)',
      points_earned: 60,
      feedback: { rating: 5, poured_by_partner: true },
    },
    kekeOrder(
      {
        reference: 'MO-9PXD4R7MNE',
        created_at: lagos('2026-09-24', 14, 15),
        stage: 'delivered',
        delivered_at: lagos('2026-09-24', 15, 2),
        delivered_quantity: '300 L · 75 gal',
        points_earned: 20,
        timeline: [
          { label: 'Order placed', at: lagos('2026-09-24', 14, 15) },
          { label: 'Delivered, code verified', at: lagos('2026-09-24', 15, 2) },
        ],
      },
      25,
      12,
    ),
    kekeOrder(
      {
        reference: 'MO-4WQ8NB2RYE',
        created_at: lagos('2026-09-11', 9, 30),
        stage: 'cancelled',
        address_label: "Mum's House",
        address: '27 Chime Avenue, New Haven',
        landmark: 'Opposite the filling station',
        payment: { method: 'pay_on_delivery', status: 'unpaid' },
        partner: null,
        station_name: null,
        timeline: [
          { label: 'Order placed', at: lagos('2026-09-11', 9, 30) },
          { label: 'Cancelled', at: lagos('2026-09-11', 10, 5), detail: 'Cancelled by support at your request' },
        ],
      },
      50,
      30,
    ),
    kekeOrder(
      {
        reference: 'MO-2BQ7TV9HXA',
        created_at: lagos('2026-08-30', 13, 5),
        stage: 'delivered',
        delivered_at: lagos('2026-08-30', 13, 50),
        delivered_quantity: '600 L · 150 gal',
        points_earned: 30,
        timeline: [
          { label: 'Order placed', at: lagos('2026-08-30', 13, 5) },
          { label: 'Delivered, code verified', at: lagos('2026-08-30', 13, 50) },
        ],
      },
      25,
      24,
    ),
  ]

  const partnerSeed = seedPartners(now, DEMO_PASSWORD)
  const extra = seedOtherCustomers(partnerSeed.jobs)
  return {
    partners: partnerSeed.partners,
    jobs: partnerSeed.jobs,
    admin: seedAdmin(now),
    users: [
      ...partnerSeed.users,
      ...extra.users,
      { id: DEMO_ADMIN_ID, name: ADMIN_NAME, phone: '+2348000000100', role: 'admin', phone_verified: true, password: DEMO_PASSWORD },
      {
        id: DEMO_CUSTOMER_ID,
        name: 'Adaeze Nwosu',
        phone: '+2348031234567',
        role: 'customer',
        phone_verified: true,
        password: DEMO_PASSWORD,
      },
      { id: TEST_CUSTOMER_ID, name: 'Test Customer', phone: '+2348090000101', role: 'customer', phone_verified: true, password: DEMO_PASSWORD },
    ],
    sessionUserId: null,
    sessionExpiresAt: null,
    pushSubscriptions: {},
    customers: {
      ...extra.customers,
      [TEST_CUSTOMER_ID]: emptyCustomerData(now),
      [DEMO_CUSTOMER_ID]: {
        profile: {
          email: 'adaeze.n@example.com',
          customer_since: '2026-08-01',
          photo_url: null,
          preferences: { sms_updates: true, whatsapp_updates: true, offers_and_news: false },
        },
        addresses: [
          { id: 'addr-home', label: 'Home', address: '12 Lakeview Street, GRA, Enugu', landmark: 'Beside Parkview Hotel', is_default: true },
          { id: 'addr-office', label: 'Office', address: '4 Zik Avenue, Uwani, Enugu', landmark: 'Second gate, ask for the cashier', is_default: false },
          { id: 'addr-mum', label: "Mum's House", address: '27 Chime Avenue, New Haven', landmark: 'Opposite the filling station', is_default: false },
        ],
        orders,
        notifications: [
          { id: 'n1', kind: 'on_the_way', title: 'Your water is on the way', body: 'Chinedu collected 600 L (150 gal) and is heading to Home.', at: lagosToday(11, 20, now), read: false, reference: 'MO-7KQ2M9XH4T' },
          { id: 'n2', kind: 'rider_assigned', title: 'Rider assigned', body: 'Chinedu Okafor (Keke, ENU 482 KK) accepted MO-7KQ2.', at: lagosToday(11, 2, now), read: false, reference: 'MO-7KQ2M9XH4T' },
          { id: 'n3', kind: 'order_received', title: 'Order received', body: 'We are finding a rider for MO-7KQ2.', at: activeCreated, read: true, reference: 'MO-7KQ2M9XH4T' },
          { id: 'n4', kind: 'points', title: 'You earned 60 points', body: 'Thanks for ordering MO-5KL2.', at: lagos('2026-10-02', 9, 35), read: true, reference: 'MO-5KL2ZT8QWD' },
          { id: 'n5', kind: 'payment', title: 'Payment confirmed', body: 'Our team confirmed your bank transfer for MO-5KL2.', at: lagos('2026-10-02', 10, 0), read: true, reference: 'MO-5KL2ZT8QWD' },
        ],
        points: {
          balance: 250,
          history: [
            { id: 'p1', kind: 'earned', label: 'Earned · MO-5KL2 delivered', at: '2 Oct 2026', points: 60 },
            { id: 'p2', kind: 'earned', label: 'Earned · MO-9PXD delivered', at: '24 Sep 2026', points: 20 },
            { id: 'p3', kind: 'redeemed', label: 'Redeemed · ₦100 off', at: '24 Sep 2026', points: -100 },
            { id: 'p4', kind: 'earned', label: 'Earned · 3 earlier orders', at: 'Sep 2026', points: 120 },
            { id: 'p5', kind: 'adjusted', label: 'Adjusted by support · late delivery', at: '12 Sep 2026', points: 50 },
            { id: 'p6', kind: 'bonus', label: 'Welcome bonus', at: '30 Aug 2026', points: 100 },
          ],
        },
        tickets: [
          { id: 't1', number: '#CP-004', title: 'Delivery was late', at: lagos('2026-09-12', 12, 0), note: '50 points added', status: 'resolved', kind: 'problem' },
          { id: 't2', number: '#CP-009', title: 'Change my default address', at: lagos('2026-10-02', 12, 0), note: null, status: 'resolved', kind: 'question' },
        ],
      },
    },
  }
}

/** Partner shown to the customer for seeded jobs already accepted. */
const PARTNER_FOR_ORDER: Record<string, typeof CHINEDU | typeof EMEKA> = {
  [DEMO_RIDER_ID]: CHINEDU,
  [DEMO_DRIVER_ID]: EMEKA,
}

/** The customer's view of a seeded job, so the admin, customer and partner screens show one order. */
function orderFromJob(job: StoredJob, payment: MockCustomerOrder['payment'], addressLabel: string): MockCustomerOrder {
  const quote = quoteFor(job.choice, ANY_PLACE)
  if (quote.status !== 'quote_available') throw new Error('seed quote')
  const stage: MockCustomerOrder['stage'] =
    job.stage === 'accepted'
      ? 'rider_assigned'
      : job.stage === 'collected'
        ? 'on_the_way'
        : job.stage === 'delivered'
          ? 'delivered'
          : job.stage === 'cancelled'
            ? 'cancelled'
            : 'waiting_rider'
  const delivered = stage === 'delivered'
  return {
    reference: job.reference,
    created_at: job.created_at,
    choice: job.choice,
    address_label: addressLabel,
    address: job.customer.address,
    landmark: job.customer.landmark ?? null,
    receiver_name: job.customer.contact_name,
    receiver_phone: job.customer.phone,
    instructions: job.instructions,
    stage,
    payment,
    quote,
    partner: job.partner_id && stage !== 'waiting_rider' ? (PARTNER_FOR_ORDER[job.partner_id] ?? null) : null,
    station_name: stage === 'waiting_rider' ? null : job.station.name,
    eta_minutes: null,
    delivery_code: stage === 'waiting_rider' || stage === 'rider_assigned' || stage === 'on_the_way' ? job.mock_code : null,
    timeline: [{ label: 'Order placed', at: job.created_at }, ...(delivered && job.delivered_at ? [{ label: 'Delivered, code verified', at: job.delivered_at }] : [])],
    delivery_window: null,
    delivered_at: delivered ? job.delivered_at : null,
    delivered_quantity: delivered ? describeChoice(job.choice, 'short') : null,
    points_earned: delivered ? quote.points_estimate : null,
    feedback: null,
  }
}

interface SeedPerson {
  name: string
  phone: string
  address: string
  label: string
}

/** A past Keke order that has no job in the pool (history from before). */
function pastOrder(
  reference: string,
  at: string,
  size: 25 | 50,
  count: number,
  owner: SeedPerson,
  stage: 'delivered' | 'cancelled',
  payment: MockCustomerOrder['payment'],
): MockCustomerOrder {
  const delivered = stage === 'delivered'
  return kekeOrder(
    {
      reference,
      created_at: at,
      stage,
      address_label: owner.label,
      address: owner.address,
      landmark: null,
      receiver_name: owner.name,
      receiver_phone: owner.phone,
      payment,
      partner: delivered ? CHINEDU : null,
      station_name: delivered ? 'GRA Refill Station' : null,
      delivered_at: delivered ? at : null,
      delivered_quantity: delivered ? `${size * count} L` : null,
      points_earned: delivered ? 25 : null,
      timeline: [
        { label: 'Order placed', at },
        { label: delivered ? 'Delivered, code verified' : 'Cancelled', at },
      ],
    },
    size,
    count,
  )
}

function customerData(since: string, addresses: SavedAddress[], orders: MockCustomerOrder[], points: number): CustomerData {
  return {
    profile: { email: null, customer_since: since, photo_url: null, preferences: { sms_updates: true, whatsapp_updates: false, offers_and_news: false } },
    addresses,
    orders,
    notifications: [],
    points: { balance: points, history: points ? [{ id: 'p1', kind: 'earned', label: 'Earned · earlier orders', at: 'Sep 2026', points }] : [] },
    tickets: [],
  }
}

/**
 * The other SAMPLE customers on the admin screens (a-customers, a-orders).
 * Ifeoma Eze and Kelechi Obi start unverified (FR-003). Their orders are the
 * seeded pool jobs with their names, plus a little history.
 */
function seedOtherCustomers(jobs: StoredJob[]): { users: MockUser[]; customers: Record<string, CustomerData> } {
  const byRef = (r: string) => {
    const j = jobs.find((x) => x.reference === r)
    if (!j) throw new Error(`seed job ${r}`)
    return j
  }
  const unpaid = { method: 'pay_on_delivery', status: 'unpaid' } as const
  const paid = { method: 'pay_on_delivery', status: 'paid' } as const
  const ifeoma: SeedPerson = { name: 'Ifeoma Eze', phone: '+2348065550192', address: '8 Zion Close, Independence Layout', label: 'Home' }
  const blessing: SeedPerson = { name: 'Blessing Udo', phone: '+2348149093321', address: '22 Market Lane, Ogui', label: 'Home' }
  const kelechi: SeedPerson = { name: 'Kelechi Obi', phone: '+2347024408812', address: '7 Nike Road, Abakpa', label: 'Home' }

  const users: MockUser[] = [
    { id: 'user-ifeoma', name: ifeoma.name, phone: ifeoma.phone, role: 'customer', phone_verified: false, password: DEMO_PASSWORD },
    { id: 'user-chukwudi', name: 'Chukwudi Ilonze', phone: '+2348092227710', role: 'customer', phone_verified: true, password: DEMO_PASSWORD },
    { id: 'user-blessing', name: blessing.name, phone: blessing.phone, role: 'customer', phone_verified: true, password: DEMO_PASSWORD },
    { id: 'user-kelechi', name: kelechi.name, phone: kelechi.phone, role: 'customer', phone_verified: false, password: DEMO_PASSWORD },
    { id: 'user-obinna', name: 'Obinna Agu', phone: '+2348000000207', role: 'customer', phone_verified: true, password: DEMO_PASSWORD },
  ]

  // The pool job carries the same payment state as the order.
  byRef('MO-8ZRW2KTM5C').payment_status = 'awaiting_verification'

  const customers: Record<string, CustomerData> = {
    'user-ifeoma': customerData(
      '2026-09-10',
      [
        { id: 'addr-home', label: 'Home', address: ifeoma.address, landmark: null, is_default: true },
        { id: 'addr-shop', label: 'Shop', address: 'Stall 42, Ogbete Main Market', landmark: null, is_default: false },
      ],
      [
        orderFromJob(byRef('MO-3HT8WQ2KZP'), unpaid, 'Home'),
        pastOrder('MO-3HS7VP2KXA', lagos('2026-09-30', 10, 0), 50, 12, ifeoma, 'delivered', paid),
        pastOrder('MO-3HR6TN1JWB', lagos('2026-09-22', 9, 40), 50, 12, ifeoma, 'delivered', paid),
        pastOrder('MO-3HQ5SM9HVC', lagos('2026-09-14', 16, 5), 50, 12, ifeoma, 'delivered', paid),
      ],
      90,
    ),
    'user-chukwudi': customerData(
      '2026-08-12',
      [{ id: 'addr-home', label: 'Home', address: '27 Chime Avenue, New Haven', landmark: null, is_default: true }],
      [orderFromJob(byRef('MO-5KL3ZT8QWE'), unpaid, 'Home')],
      120,
    ),
    'user-blessing': customerData(
      '2026-09-01',
      [{ id: 'addr-home', label: 'Home', address: blessing.address, landmark: null, is_default: true }],
      [pastOrder('MO-9PXE5S8NQF', lagos('2026-10-12', 11, 30), 25, 30, blessing, 'delivered', paid)],
      40,
    ),
    'user-kelechi': customerData(
      '2026-10-05',
      [{ id: 'addr-home', label: 'Home', address: kelechi.address, landmark: null, is_default: true }],
      [pastOrder('MO-4WQ9NC3RZF', lagos('2026-10-13', 15, 40), 50, 24, kelechi, 'cancelled', { method: 'bank_transfer', status: 'refund_due' })],
      0,
    ),
    'user-obinna': customerData(
      '2026-08-25',
      [{ id: 'addr-home', label: 'Home', address: '6 Ekulu Road, Trans-Ekulu', landmark: null, is_default: true }],
      [
        orderFromJob(byRef('MO-8ZRW2KTM5C'), { method: 'bank_transfer', status: 'awaiting_verification' }, 'Home'),
        orderFromJob(byRef('MO-8ZRX3KTM6D'), paid, 'Home'),
      ],
      60,
    ),
  }
  return { users, customers }
}

/** Empty data for a customer who has just created an account. */
export function emptyCustomerData(now = new Date()): CustomerData {
  return {
    profile: {
      email: null,
      customer_since: now.toISOString().slice(0, 10),
      photo_url: null,
      preferences: { sms_updates: true, whatsapp_updates: false, offers_and_news: false },
    },
    addresses: [],
    orders: [],
    notifications: [],
    points: { balance: 0, history: [] },
    tickets: [],
  }
}
