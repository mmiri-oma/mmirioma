import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../lib/cx'
import { CONTACT } from './content'
import { ArrowLeftIcon } from './icons'
import { BrandLogo } from './MarketingParts'
import { FloatingActions } from './SiteExtras'
import { useMarketingPage } from './useMarketingPage'

/*
 * Terms of Service (/terms) and Privacy Notice (/privacy). The Terms started
 * from design/MmiriOma-landing-handoff/content/*.md and were corrected to
 * describe the pilot as it works (#107): cash on delivery only (F4), the
 * window agreed on the confirmation call (F3), no cancellation or redelivery
 * charge (F5), refunds decided and paid outside the app (F7), no points
 * (customer-account.md decision 12) and no partner pay in the app
 * (partners.md decision 7). The Privacy Notice mirrors PRIVACY_NOTICE.md
 * (#93). Both are reviewed by the legal operator before launch.
 */

interface Section {
  id: string
  title: string
  body: ReactNode
  /** The final "Contact us" section sits in a tinted box. */
  boxed?: boolean
  /** A second anchor on the heading (Privacy section 9 is also `#cookies`). */
  headingId?: string
}

const Phone = () => <a href={CONTACT.phoneHref}>{CONTACT.phoneLabel}</a>
/** Privacy and legal contact from PRIVACY_NOTICE.md (sections 1, 9 and 16). */
const PRIVACY_EMAIL = 'olivetgrail@gmail.com'
const PrivacyEmail = () => <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
const ADDRESS = 'Hackathon Innovation Lab, ECCIMA Building, opposite All Saints Church, Garden Avenue, GRA, Enugu, Enugu State, Nigeria.'

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="m-0 flex flex-col gap-2 pl-[22px]">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  )
}

const TERMS_VERSION = 'Last updated 27 October 2026.'

const TERMS: Section[] = [
  {
    id: 't1',
    title: '1. About these terms',
    body: (
      <p>
        {TERMS_VERSION} These Terms of Service ("Terms") apply to the MmiriOma website, customer app and driver app (together, the "Service"), operated by
        MmiriOma ("we", "us") in Enugu State, Nigeria. By creating an account or placing an order, you agree to these Terms and to our{' '}
        <Link to="/privacy">Privacy Notice</Link>. If you don't agree, please don't use the Service.
      </p>
    ),
  },
  {
    id: 't2',
    title: '2. Your account',
    body: (
      <p>
        You must be at least 18 years old to create an account. Give us accurate details, including your phone number and delivery addresses,
        and keep them up to date. You are responsible for activity on your account, so keep your login details private and tell us straight away
        if you think someone else has used it.
      </p>
    ),
  },
  {
    id: 't3',
    title: '3. Orders and pricing',
    body: (
      <>
        <p>
          You can order by keke (our cans poured into your containers) or by tanker (pumped into your ground or overhead tank). When the app can
          work out a price for your address, it shows the total before you send your order; otherwise our team works out the price and tells
          you on the confirmation call. Prices can depend on volume, delivery type and distance, and may change from time to time, but the
          price you agree is the price you pay for that order.
        </p>
        <p>
          After you send an order, our team calls you to agree the delivery window, and the price if the app did not show one, and then
          confirms the order. Until then your order is a request, not a booked delivery. We may decline or cancel an order if your address is
          outside our service areas, the details are incomplete, or delivery is not safely possible.
        </p>
      </>
    ),
  },
  {
    id: 't4',
    title: '4. Delivery',
    body: (
      <>
        <p>
          We agree a delivery window with you on the confirmation call. Traffic, weather and road conditions can still cause delays; if the
          window has to change, we contact you to agree a new one. The app shows each confirmed step of your order, but it does not track the
          rider or driver live on a map.
        </p>
        <List
          items={[
            'Make sure someone can receive the water and that the rider can safely reach your gate, drums or tank.',
            'For keke orders, provide clean containers. The rider pours the water and takes our empty cans back.',
            'For tanker orders, tell us whether your tank is ground or overhead and make sure there is room for the hose to reach it.',
            "If no one can be reached when the rider or driver arrives, they try to contact you twice and wait 10 minutes before recording a failed delivery. You can then arrange another delivery with us.",
            'During the pilot there is no charge for cancelling an order or for a new delivery after a failed one.',
          ]}
        />
      </>
    ),
  },
  {
    id: 't5',
    title: '5. The delivery code',
    body: (
      <>
        <p>
          When the rider or driver records that unloading is complete, we send a one-time delivery code by SMS to the order's contact number.
          It works for 10 minutes. Give it to them only after the full quantity has been poured or pumped. Giving the code confirms that you
          received the water as described; it is separate from paying for it. If anything is wrong, don't give the code. Call us or report it
          in the app instead so we can sort it out.
        </p>
        <p>If you share the code with someone else to receive the water for you, their confirmation counts as yours.</p>
      </>
    ),
  },
  {
    id: 't6',
    title: '6. Payment',
    body: (
      <p>
        During the pilot you pay in cash on delivery, to the rider or driver, after the water has been unloaded. The app does not take card,
        online or bank-transfer payments. All prices are in Nigerian Naira (₦).
      </p>
    ),
  },
  {
    id: 't7',
    title: '7. Cancellations and refund requests',
    body: (
      <>
        <p>
          To cancel an order, call us on <Phone />. During the pilot there is no cancellation charge.
        </p>
        <p>
          If you think you are owed money back, for example because a delivery was short, contact us. Our team reviews each request, and any
          refund we approve is paid to you outside the app, for example by bank transfer. The app does not hold credit or points.
        </p>
      </>
    ),
  },
  {
    id: 't8',
    title: '8. Water quality',
    body: (
      <p>
        Each order states its water category, Potable Water or Utility Water, and what it is suitable for. Only Potable Water is described as
        drinking water. Once water is poured into your containers or tank, its condition also depends on how clean they are, so please clean
        and cover them regularly. If something is wrong with a delivery, tell us before giving your delivery code, or within 48 hours of
        delivery. A safety concern or suspected contamination can be reported at any time.
      </p>
    ),
  },
  {
    id: 't9',
    title: '9. Riders and drivers',
    body: (
      <p>
        Riders and drivers sign up in the driver app with their name, phone number, vehicle type, plate number and the tank capacity they
        declare, and must be approved by our team, which checks the vehicle, before taking jobs. They must handle water hygienically, treat
        customers with respect and follow traffic laws. During the pilot the driver app does not show earnings or make payments; how riders
        and drivers are paid is agreed with our team outside the app.
      </p>
    ),
  },
  {
    id: 't10',
    title: '10. Acceptable use',
    body: (
      <p>
        Don't use the Service to place fake orders, harass riders or customers, misuse delivery codes, or interfere with the apps. We may suspend
        or close accounts that break these Terms.
      </p>
    ),
  },
  {
    id: 't11',
    title: '11. Liability',
    body: (
      <p>
        We work hard to deliver on time and in full, but the Service is provided as available. To the extent the law allows, our liability for
        any order is limited to the amount you paid for that order. Nothing in these Terms limits rights you have under Nigerian consumer
        protection law, including the Federal Competition and Consumer Protection Act.
      </p>
    ),
  },
  {
    id: 't12',
    title: '12. Changes and governing law',
    body: (
      <p>
        We may update these Terms as the Service grows. When we make important changes, we'll tell you before they take effect and update the date at the top of these Terms. These
        Terms are governed by the laws of the Federal Republic of Nigeria, and disputes will be handled by the courts in Enugu State.
      </p>
    ),
  },
  {
    id: 't13',
    title: '13. Contact us',
    boxed: true,
    body: (
      <p>
        Questions about these Terms? Call <Phone /> or email <PrivacyEmail />. Our address is {ADDRESS}
      </p>
    ),
  },
]

/** One "what / why" or "what / how long" pair, as the notice's tables have. */
function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <ul className="m-0 flex flex-col gap-3 pl-[22px]">
      {rows.map(([what, why], i) => (
        <li key={i}>
          <b className="text-ink">{what}</b>
          <br />
          {why}
        </li>
      ))}
    </ul>
  )
}

/*
 * The Privacy page mirrors PRIVACY_NOTICE.md (version 3.0) section by
 * section, with the same facts (#93). Change both together; the notice is the
 * source.
 */
const PRIVACY_VERSION = 'Version 3.0, last updated 1 November 2026.'

const PRIVACY: Section[] = [
  {
    id: 'p1',
    title: '1. Who operates MmiriOma?',
    body: (
      <>
        <p>
          {PRIVACY_VERSION} MmiriOma is a water ordering and delivery service for households and businesses, starting with a pilot in Enugu
          State, Nigeria. This notice explains what personal information we collect when you create an account, request water, receive a
          delivery, pay, contact us or deliver for us as a rider or driver; why we use it; who receives it; how long we keep it; and how you can
          exercise your rights. We aim to handle personal data in accordance with the Nigeria Data Protection Act 2023. It describes the service as
          it works during the pilot. See also our <Link to="/terms">Terms of Service</Link>.
        </p>
        <List
          items={[
            'Legal operator and data controller: Nnamdi Ileh',
            'Location: Enugu State, Nigeria',
            <>
              Support telephone: <Phone />
            </>,
            <>
              Privacy email: <PrivacyEmail />
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'p2',
    title: '2. What information do we collect?',
    body: (
      <>
        <Rows
          rows={[
            [
              'Your name, your mobile number (verified by an SMS code) and your password',
              'To create and protect your account and contact you about your orders. Your password is stored only in a scrambled (hashed) form.',
            ],
            [
              'Delivery details for each order: contact name and phone number, delivery address, landmark, delivery instructions, preferred date and quantity',
              'To check that we can serve the area, agree the price and time with you, and deliver.',
            ],
            [
              'Saved addresses: a name you give each one (for example "Home"), the address, landmark and the delivery area you choose',
              'To let you reuse an address when you order; the area tells us whether we can deliver there.',
            ],
            [
              'If you deliver for us as a rider or driver: your name, mobile number, password, vehicle type (keke or tanker), plate number, the tank capacity you declare, the area you serve, your approval status and whether you are available for work',
              'To check your vehicle and approve you before you take jobs, offer you only jobs your vehicle can carry, and contact you about deliveries.',
            ],
            [
              'Order records: water category, the water source used, the agreed price and how you agreed it, the confirmed delivery window, and each change of order status',
              'To process and support your order, and keep a history of what happened.',
            ],
            [
              'Delivery records: arrival time, attempts to contact you, quantity delivered, how the delivery was confirmed, and any incident the driver or our staff record',
              'To confirm delivery and resolve problems or disputes.',
            ],
            [
              "Optional GPS location of the driver's phone at arrival and at delivery",
              'To support delivery verification. Recorded only when the driver has given consent and their phone allows it; never used to track you.',
            ],
            ['Cash payment records: amount due, amount collected, who collected and received it, and when', 'To account for cash paid on delivery.'],
            ['Bank account details, only if we pay you a refund by bank transfer', 'To make that refund.'],
            ['What you tell us when you call or message our support line', 'To answer your questions and handle complaints.'],
            [
              'Problems and questions you send in the app ("Report a problem" and Help): the type of problem, your message, the order it is about, its status and how our staff resolved it',
              'To investigate and resolve the problem, and handle complaints.',
            ],
            [
              "Feedback you give on a delivered order: your rating (1 to 5), whether the rider or driver unloaded the water, and, if you choose to answer, whether it was on time, whether you got the quantity you ordered, whether you would order again, and a short message",
              "To check and improve our deliveries and our riders' and drivers' service.",
            ],
            [
              'Account deletion requests you make in the app: when you asked, the reason if you give one, and the outcome',
              'To handle your request (section 9) and keep a record that we did.',
            ],
            ['Messages we show you in the app about your orders or jobs', 'To keep you informed. A message never changes an order.'],
            [
              'Technical records: your sign-in session, and server logs (IP address, time and the page or action requested)',
              'To keep you signed in, protect the service from misuse and fix problems.',
            ],
          ]}
        />
        <p>
          We do <b>not</b> collect your email address, photographs of you or your premises, or bank card details in the app. If you give someone
          else's name and phone number as the delivery contact, please tell them; we use their details only for that delivery.
        </p>
      </>
    ),
  },
  {
    id: 'p3',
    title: '3. Why do we use personal data?',
    body: (
      <>
        <p>
          We use personal information to create and protect accounts; verify phone numbers; agree prices and delivery times; arrange water supply,
          dispatch and delivery; send messages about your order; record cash payments; pay refunds; confirm delivery; investigate complaints and
          incidents; prevent misuse; keep the service secure; and comply with the law.
        </p>
        <p>
          Depending on the activity, our lawful basis may be performing or preparing a contract with you, complying with legal obligations, our
          legitimate interests where appropriate, or your consent where the law requires it. We do not send promotional messages.
        </p>
      </>
    ),
  },
  {
    id: 'p4',
    title: '4. Phone verification and service messages',
    body: (
      <p>
        You must verify your mobile number before your first order. We send a 6-digit code by SMS; it works for 5 minutes and is stored only in a
        scrambled (hashed) form, so we cannot read it back. We also send SMS messages about your order, such as when it is confirmed, when the driver
        sets off, and your delivery code, and we show order updates as messages in the app. We do not sell or share telephone numbers with
        advertisers.
      </p>
    ),
  },
  {
    id: 'p5',
    title: '5. Addresses and location data',
    body: (
      <p>
        We use the address, landmark and instructions you type to decide whether we can deliver, agree the price and find you. The app does not ask
        for your phone's location. The only location we record is the optional GPS position of the <b>driver's</b> phone at arrival and at
        delivery, with the driver's consent (section 2). We do not track you or show live vehicle locations.
      </p>
    ),
  },
  {
    id: 'p6',
    title: '6. Payments, refunds and delivery evidence',
    body: (
      <>
        <p>
          During the pilot you pay in cash on delivery, after the water has been unloaded. The app does not take card, online or bank-transfer
          payments. We record the amount due, the cash collected, and its handover from the driver to our staff.
        </p>
        <p>
          Refunds are decided and paid by our administrator outside the app. If a refund is paid by bank transfer, we ask for the account details
          needed for that transfer and use them only for that refund.
        </p>
        <p>
          When the driver records that unloading is complete, we send a 6-digit delivery code by SMS to the order's contact number. It works for 10
          minutes and is stored only in a scrambled (hashed) form. You give the code to the driver to confirm you received the water. If you cannot
          receive the code, our administrator may approve other evidence instead, such as your acknowledgment, the delivery time and the driver's
          report, and records who approved it and why. The app takes no photographs. Confirming that water was received is separate from confirming
          that it was paid for.
        </p>
      </>
    ),
  },
  {
    id: 'p7',
    title: '7. Who receives your information?',
    body: (
      <>
        <p>We share only what is needed to run the service:</p>
        <List
          items={[
            "The driver assigned to your order sees the contact's first name and last initial, phone number, delivery address, landmark, instructions and quantity, and only while they are assigned to the delivery.",
            "Our authorized staff (administrators and dispatchers) see order and account details, including riders' and drivers' vehicle and approval details, to confirm, dispatch and support orders and to approve riders and drivers.",
            'Termii, our SMS provider, receives your phone number and the text of each message we send you.',
            "Hostinger (HOSTINGER Global S.à r.l., Luxembourg), our hosting provider, runs the server and stores the service's data and backups in its data centre in Paris, France.",
            'Backblaze (Backblaze, Inc., United States) stores an off-site copy of our backups in its data centre in Amsterdam, the Netherlands.',
          ]}
        />
        <p>
          The app does not give your details to water suppliers or advertisers. We may disclose data when required by law. Because our hosting
          provider stores the service's data in France and our backup provider stores copies of it in the Netherlands, your personal information
          is processed outside Nigeria; we assess and apply the
          safeguards required by Nigerian data-protection law for such transfers, and do the same for any other provider that processes personal
          data outside Nigeria.
        </p>
      </>
    ),
  },
  {
    id: 'p8',
    title: '8. How long do we keep information?',
    body: (
      <>
        <p>
          Our staff review stored data every month and delete or anonymize what has reached the end of its period; the period below is the earliest
          it becomes due. We may keep a limited record longer when justified by law, an active dispute, a fraud investigation or a documented legal
          hold (section 10). Deletion may mean removing information or irreversibly anonymizing it.
        </p>
        <Rows
          rows={[
            [
              'Phone verification codes: usable for 5 minutes',
              'The scrambled code is deleted at the next monthly review; the record of when your number was verified or changed is kept with your account.',
            ],
            [
              'Delivery codes: usable for 10 minutes',
              'The scrambled code is deleted at the next monthly review; the record that delivery was confirmed is kept with the order.',
            ],
            [
              'Accounts never verified: 30 days without verification',
              'The account is deleted. If our records of important changes must keep a reference to it (for example, the account changed its password), it is anonymized and closed instead: its name and phone number are removed and it can no longer be used.',
            ],
            [
              'Your account and profile: while your account is open and needed for the service',
              'Deleted or anonymized after a verified deletion request (section 9), subject to the exceptions in section 10.',
            ],
            ['Saved addresses: while your account is open', 'Deleted when your account is closed.'],
            ['Messages in the app: as long as the order they are about', 'Deleted when your account is closed.'],
            [
              'Order and delivery records, including delivery addresses: 3 years after the order is completed',
              'Personal details deleted or anonymized; the payment subset is kept as below.',
            ],
            [
              "Feedback on an order: as long as the order record (3 years after the order is completed)",
              "Your message is removed when the order's personal details are deleted or anonymized, or when your account is closed; the rating and answers stay with the anonymized order, as they no longer identify you.",
            ],
            ['Driver GPS points: 90 days after the delivery', 'Deleted, unless needed for an open complaint or dispute.'],
            [
              'Cash payment and refund records, including refund bank details: at least 6 years, or longer where Nigerian accounting or tax law requires',
              'Securely deleted or anonymized when that obligation ends.',
            ],
            ['Complaints, disputes and incident records: 3 years after resolution', 'Deleted or anonymized, unless continued retention is justified.'],
            ['Calls and messages on our support line: 12 months after the matter is resolved', 'Deleted, unless linked to an unresolved matter.'],
            [
              'Problems you report in the app: 3 years after our staff resolve it',
              "Deleted. If your account is closed sooner, your message and our staff's note about it are removed then, and the rest of the record is kept until the 3 years end.",
            ],
            [
              'Account deletion requests: 3 years after we complete or refuse your request',
              'Deleted. Until then, the reference, dates and outcome are kept as a record that the request was handled; the reason you gave is removed earlier, when your account is closed.',
            ],
            ['Sign-in sessions: a session lasts up to 7 days', 'Ended sessions are deleted at the next monthly review.'],
            ['Server logs: 90 days', 'Deleted, unless needed to investigate a security incident.'],
            ['Encrypted backups: up to 30 days', 'They expire on schedule (section 10).'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'p9',
    title: '9. How can you request access, correction or deletion?',
    body: (
      <>
        <p>
          You can ask us to access, correct or delete your personal information by calling <Phone /> or emailing <PrivacyEmail />. Before we
          disclose or change anything, we confirm the request comes from you, normally by calling back the phone number on your account.
          For deletion, you can also use "Delete my account" in the customer app; we still call you back to confirm it is you.
        </p>
        <List
          items={[
            'We acknowledge a request within 3 working days.',
            'We aim to complete a straightforward request within 14 calendar days, and always within any deadline the law sets.',
            'We tell you if some records must be kept (for example cash payment records, an open refund or an unresolved dispute), and we restrict their use.',
          ]}
        />
        <p>
          For a deletion request, we first check for open orders, cash not yet settled, refunds and disputes. We then close your account, which signs
          you out everywhere, delete or anonymize your profile and the personal details on your orders, keep only the records we must keep, and tell
          you the outcome.
        </p>
      </>
    ),
  },
  {
    id: 'p10',
    title: '10. Exceptions and backups',
    body: (
      <>
        <p>
          Records may be kept beyond the periods in section 8 for documented legal obligations, regulatory matters, litigation, fraud
          investigations or unresolved disputes. Access to these records is limited, and each exception is reviewed when its purpose ends.
        </p>
        <p>
          Deleting information from the live service does not immediately remove it from existing encrypted backups or from our SMS provider's
          records. Backups expire within 30 days. If we ever restore a backup, we apply every deletion request made since that backup was taken
          before the service is used again.
        </p>
      </>
    ),
  },
  {
    id: 'p11',
    title: '11. Security',
    body: (
      <p>
        We protect your information with HTTPS, a secure sign-in cookie, access limited to the staff and driver who need it, scrambled (hashed)
        passwords and codes, and records of important changes made by staff. No digital system can guarantee absolute security. Where a security
        incident triggers a legal notification duty, we will follow the applicable requirements.
      </p>
    ),
  },
  {
    id: 'p12',
    title: '12. Your privacy rights',
    body: (
      <p>
        Subject to the Nigeria Data Protection Act 2023 and lawful exceptions, you may have rights to access, correct or erase personal data; object
        to or restrict certain processing; withdraw consent where processing depends on it; and exercise any applicable data-portability rights. You
        can contact us using the details in section 16. You may also complain to the Nigeria Data Protection Commission at{' '}
        <a href="https://ndpc.gov.ng/" target="_blank" rel="noopener noreferrer">
          ndpc.gov.ng
        </a>
        .
      </p>
    ),
  },
  {
    id: 'p13',
    headingId: 'cookies',
    title: '13. Cookies and sessions',
    body: (
      <p>
        We use one necessary cookie to keep you signed in. It cannot be read by scripts on the page and lasts up to 7 days, or until you sign out. We
        do not use analytics or advertising cookies, and the app does not store your personal details in your browser.
      </p>
    ),
  },
  {
    id: 'p14',
    title: "14. Children's privacy",
    body: (
      <p>
        Customer accounts are for adults aged 18 and above. We do not knowingly let children create ordering accounts. If we learn that a child's
        personal information has been collected without an appropriate legal basis, we will delete it or take other necessary corrective action.
      </p>
    ),
  },
  {
    id: 'p15',
    title: '15. Changes to this notice',
    body: (
      <p>
        We will update this notice when our service, providers or data practices change, and before the change takes effect where we can. The
        current version and its date are shown at the top. We will give additional notice where the law requires it.
      </p>
    ),
  },
  {
    id: 'p16',
    title: '16. Contact',
    boxed: true,
    body: (
      <p>
        MmiriOma, Enugu State, Nigeria. Support: <Phone />. Privacy email: <PrivacyEmail />. Responsible legal operator: Nnamdi Ileh.
      </p>
    ),
  },
]

/**
 * Shared layout of the legal pages: simple header with "Back to home", a
 * tinted hero, an "On this page" box linking to every section, the article,
 * and a compact footer.
 */
function LegalPage({
  kind,
  title,
  intro,
  sections,
}: {
  kind: 'terms' | 'privacy'
  title: string
  intro: string
  sections: Section[]
}) {
  useMarketingPage(`${title} | MmiriOma`, intro)
  const terms = kind === 'terms'
  return (
    <div className="mk-page min-w-0 overflow-x-clip bg-white font-marketing text-[16px] leading-normal text-ink">
      <header className="sticky top-0 z-30 border-0 border-b border-solid border-[#E3EDF7] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto box-border flex max-w-[1200px] items-center justify-between gap-6 px-6 py-3.5">
          <Link to="/" aria-label="MmiriOma home" className="flex min-h-11 min-w-0 items-center no-underline">
            <BrandLogo className="h-auto w-[190px] max-w-full" />
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-solid border-input-line px-[18px] text-center text-[15px] font-semibold whitespace-nowrap text-ink no-underline transition-colors duration-150 hover:border-primary hover:bg-mk-panel hover:text-ink"
          >
            <ArrowLeftIcon />
            Back to home
          </Link>
        </div>
      </header>
      <main>
        <section className={terms ? 'bg-[#EEF6FF]' : 'bg-[#EFFAF7]'}>
          <div className="mx-auto box-border flex max-w-[1200px] flex-col gap-3.5 px-6 pt-16 pb-14">
            <p className={cx('m-0 text-[13px] font-bold tracking-[2px]', terms ? 'text-primary' : 'text-[#0B6A5F]')}>LEGAL</p>
            <h1 className="m-0 font-display text-[clamp(40px,5vw,60px)] font-extrabold tracking-[-1.5px] text-ink">{title}</h1>
            <p className="m-0 max-w-[640px] text-[17px] leading-[1.6] text-[#3A4F67]">{intro}</p>
            <p className="mt-1.5 mb-0 text-[14px] font-semibold text-slate">Effective date: 1 November 2026</p>
          </div>
        </section>
        <section>
          <div className="mx-auto box-border flex max-w-[1200px] flex-wrap items-start gap-14 px-6 pt-14 pb-24">
            <nav
              aria-label="On this page"
              className="box-border flex max-w-[300px] flex-[1_1_240px] flex-col gap-2.5 rounded-[18px] border border-solid border-[#DCE8F5] bg-[#F4F9FF] p-6 text-[15px]"
            >
              <p className="m-0 mb-1 font-bold text-ink">On this page</p>
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="text-slate no-underline hover:text-ink">
                  {s.title}
                </a>
              ))}
            </nav>
            <article className="flex max-w-[760px] min-w-0 flex-[999_1_560px] flex-col gap-10 text-[16px] leading-[1.75] text-slate [&_p]:m-0">
              {sections.map((s) => (
                <div
                  key={s.id}
                  id={s.id}
                  className={cx('flex flex-col gap-3', s.boxed && 'rounded-[18px] border border-solid border-[#DCE8F5] bg-[#F4F9FF] p-7')}
                >
                  <h2 id={s.headingId} className="m-0 font-display text-[26px] font-bold text-ink">
                    {s.title}
                  </h2>
                  {s.body}
                </div>
              ))}
            </article>
          </div>
        </section>
      </main>
      <footer className="bg-mk-navy text-mk-foot-text">
        <div className="mx-auto box-border flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-[14px]">
          <span className="flex flex-wrap items-center gap-4 text-mk-foot-muted">
            <BrandLogo dark className="h-8" />© 2026 MmiriOma. All rights reserved.
          </span>
          <nav aria-label="Legal" className="flex flex-wrap gap-6">
            <Link to="/" className="text-mk-foot-text no-underline hover:text-white">
              Home
            </Link>
            <Link to="/faq" className="text-mk-foot-text no-underline hover:text-white">
              FAQs
            </Link>
            <Link
              to="/terms"
              aria-current={terms ? 'page' : undefined}
              className={cx('no-underline hover:text-white', terms ? 'font-bold text-white' : 'text-mk-foot-text')}
            >
              Terms of Service
            </Link>
            <Link
              to="/privacy"
              aria-current={!terms ? 'page' : undefined}
              className={cx('no-underline hover:text-white', !terms ? 'font-bold text-white' : 'text-mk-foot-text')}
            >
              Privacy Notice
            </Link>
          </nav>
        </div>
      </footer>
      <FloatingActions />
    </div>
  )
}

/** Terms of Service (`/terms`). */
export function TermsPage() {
  return (
    <LegalPage
      kind="terms"
      title="Terms of Service"
      intro="The rules for using MmiriOma to order, deliver and receive water. Please read them before you place an order or sign up as a rider or driver."
      sections={TERMS}
    />
  )
}

/**
 * Privacy Notice (`/privacy`), the website copy of PRIVACY_NOTICE.md (#93).
 * Section 13's heading is also `#cookies`, for the footer's "Cookie Policy" link.
 */
export function PrivacyPage() {
  return (
    <LegalPage
      kind="privacy"
      title="Privacy Notice"
      intro="What personal information we collect, why, who receives it, how long we keep it and how you can exercise your rights, during the MmiriOma pilot in Enugu."
      sections={PRIVACY}
    />
  )
}
