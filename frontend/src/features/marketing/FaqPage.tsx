import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../../lib/cx'
import { WHATSAPP_GREETING, whatsappLink } from '../../lib/whatsapp'
import { CONTACT, FAQ_CATEGORIES, FAQS, filterFaqs, type FaqFilter } from './content'
import { ArrowRightIcon, ChevronIcon, MailIcon, SearchIcon, WhatsAppIcon } from './icons'
import { Kicker, MarketingFooter, MarketingHeader, Pic } from './MarketingParts'
import { formatPhone } from '../../lib/format/phone'
import { useSupportContact } from './queries'
import { FloatingActions } from './SiteExtras'
import { useMarketingPage } from './useMarketingPage'
import { jsonLd } from '../../lib/seo'

/** The FAQ as schema.org FAQPage data, built once from the same list the page shows. */
const FAQ_JSON_LD = jsonLd({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
})

const CARD_BUTTON =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] px-5 text-center text-[15px] font-bold no-underline transition-colors duration-150'

/**
 * FAQ page (`/faq`): search and category filters over the questions in
 * content.ts. Category counts follow the search; more than one answer can be
 * open (native `<details>`).
 */
export function FaqPage() {
  useMarketingPage('FAQs | Waterline', 'Answers about ordering water, delivery, your delivery code, payments and driving with Waterline in Enugu.')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FaqFilter>('All')
  const { list, counts } = filterFaqs(search, category)
  const { phone, whatsapp } = useSupportContact()

  return (
    <div className="mk-page min-w-0 overflow-x-clip bg-white font-marketing text-[16px] leading-normal text-ink">
      <MarketingHeader current="faq" />
      {/* FAQPage structured data: every question and answer, as on the page (schema.org/FAQPage). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <main>
        <section className="overflow-hidden bg-mk-panel">
          <div className="mk-wrap flex flex-wrap items-center gap-8 py-16">
            <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-4">
              <nav aria-label="Breadcrumb" className="text-[14px] text-mute">
                <Link to="/" className="no-underline hover:underline">
                  Home
                </Link>{' '}
                <span aria-hidden="true">/</span> FAQs
              </nav>
              <Kicker>Help centre</Kicker>
              <h1 className="m-0 font-display text-[clamp(38px,5vw,64px)] leading-[1.02] font-extrabold tracking-[-1.5px] text-ink">
                Frequently asked <span className="text-mk-teal">questions</span>
              </h1>
              <p className="m-0 max-w-[560px] text-[18px] leading-[1.6] text-slate">Ordering, delivery, your code, payments and driving for us. Search or pick a topic.</p>
              <label htmlFor="faq-search" className="sr-only">
                Search FAQs
              </label>
              <div className="relative mt-2 max-w-[560px]">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-[18px] -translate-y-1/2 text-mute" />
                <input
                  id="faq-search"
                  type="search"
                  placeholder="Search questions"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="box-border min-h-[58px] w-full rounded-[14px] border-[1.5px] border-solid border-input-line bg-white pr-5 pl-[50px] text-[16px] text-ink"
                />
              </div>
            </div>
            <Pic name="phone-customer" width={341} height={402} eager className="mx-auto block h-auto w-[220px] max-w-[40%] flex-[0_1_220px] max-[700.98px]:hidden" />
          </div>
        </section>

        <section>
          <div className="mk-wrap flex flex-wrap items-start gap-10 pt-14 pb-[88px]">
            <nav aria-label="FAQ categories" className="flex max-w-full flex-[1_1_250px] flex-col gap-2 min-[961px]:sticky min-[961px]:top-[100px]">
              <p className="m-0 mb-1.5 text-[13px] font-bold tracking-[1.5px] text-mute">CATEGORIES</p>
              <div className="flex flex-col gap-2 max-[860.98px]:flex-row max-[860.98px]:flex-wrap">
                {(['All', ...FAQ_CATEGORIES] as FaqFilter[]).map((c) => {
                  const on = c === category
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCategory(c)}
                      className={cx(
                        'inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-solid px-3.5 text-center text-[14px] font-semibold transition-colors duration-150 max-[860.98px]:w-auto',
                        on ? 'border-primary bg-primary text-white' : 'border-input-line bg-white text-ink hover:border-primary hover:bg-mk-panel',
                      )}
                    >
                      {c}
                      <span
                        className={cx(
                          'inline-flex h-[22px] min-w-6 items-center justify-center rounded-md px-1.5 text-[12px] font-bold',
                          on ? 'bg-white/22 text-white' : 'bg-mk-chip text-ink',
                        )}
                      >
                        {counts[c]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </nav>

            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 font-display text-[26px] font-bold text-ink">{category === 'All' ? 'All questions' : category}</h2>
                <span className="text-[14px] text-mute" aria-live="polite">
                  {list.length} {list.length === 1 ? 'question' : 'questions'}
                </span>
              </div>
              {list.length === 0 ? (
                <div className="flex flex-col items-start gap-3 rounded-[14px] border-[1.5px] border-dashed border-input-line p-7">
                  <p className="m-0 text-[16px] font-semibold text-ink">No questions match your search.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setCategory('All')
                    }}
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] border-[1.5px] border-solid border-input-line bg-white px-[18px] text-center text-[15px] font-semibold text-ink transition-colors duration-150 hover:border-primary hover:bg-mk-panel"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                list.map((f) => (
                  <details
                    key={f.q}
                    className="group rounded-[14px] border border-solid border-line bg-white px-[22px] transition-colors duration-150 hover:border-mk-faq-open open:border-mk-faq-open open:shadow-[0_6px_20px_rgba(15,60,120,0.06)]"
                  >
                    <summary className="flex min-h-16 items-center justify-between gap-4 text-[16px] font-semibold text-ink">
                      <span className="flex flex-col gap-[3px] py-3">
                        <span className="text-[12px] font-bold tracking-[1px] text-mk-kicker uppercase">{f.cat}</span>
                        {f.q}
                      </span>
                      <ChevronIcon className="shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <p className="mt-0 mb-5 max-w-[720px] text-[15px] leading-[1.7] text-slate">{f.a}</p>
                  </details>
                ))
              )}

              <div className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4">
                <div className="flex flex-col gap-2.5 rounded-[20px] bg-ink p-7 text-white">
                  <p className="m-0 font-display text-[22px] font-bold">Didn't find your answer?</p>
                  <p className="m-0 text-[15px] leading-[1.6] text-mk-on-navy">Ask us about an order, a delivery or a payment.</p>
                  <div className="mt-auto flex flex-wrap gap-2.5 pt-1">
                    {whatsapp ? (
                      <a
                        href={whatsappLink(whatsapp, WHATSAPP_GREETING)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cx(CARD_BUTTON, 'bg-[#1DA851] text-white hover:bg-[#178A43] hover:text-white')}
                      >
                        <WhatsAppIcon size={18} />
                        Chat on WhatsApp
                      </a>
                    ) : (
                      <a href={`tel:${phone}`} className={cx(CARD_BUTTON, 'bg-white text-ink hover:bg-mk-panel hover:text-ink')}>
                        Call {formatPhone(phone)}
                      </a>
                    )}
                    <a href={`mailto:${CONTACT.email}`} className={cx(CARD_BUTTON, 'bg-white text-ink hover:bg-mk-panel hover:text-ink')}>
                      <MailIcon />
                      Email support
                    </a>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 rounded-[20px] bg-mk-tanker p-7">
                  <p className="m-0 font-display text-[22px] font-bold text-ink">Want to deliver with us?</p>
                  <p className="m-0 text-[15px] leading-[1.6] text-mk-lead">Use your own keke or tanker. Apply in the driver app. Once we approve you, you can take orders.</p>
                  <Link to="/partner/signup" className={cx(CARD_BUTTON, 'mt-auto self-start bg-mk-teal-button text-white hover:bg-[#0A5559] hover:text-white')}>
                    Become a Rider or Driver
                    <ArrowRightIcon size={15} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter variant="short" />
      <FloatingActions />
    </div>
  )
}
