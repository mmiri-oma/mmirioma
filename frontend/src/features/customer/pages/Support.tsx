import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import { MessageCircleIcon, MessageSquareIcon, PhoneIcon } from '../../../components/icons/icons'
import { BackLink, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { ActionTile, IconBadge, SectionTitle } from '../../../components/ui/Content'
import { TextAreaField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { PROBLEM_LABEL, isActiveStage, shortReference, type ProblemType } from '../../../domain/orders'
import { orderQuantityText } from '../orderHelpers'
import { errorMessage } from '../../../lib/api/errorMessage'
import { cx } from '../../../lib/cx'
import { formatShortDate } from '../../../lib/format/datetime'
import { useWhatsappNumber } from '../../marketing/queries'
import { useCreateTicket, useOrders, useTickets } from '../queries'

const TYPES = Object.keys(PROBLEM_LABEL) as ProblemType[]

/** Support: contact options, report a problem, past requests (`c-support`). */
export function Support() {
  const [params] = useSearchParams()
  const orders = useOrders()
  const tickets = useTickets()
  const create = useCreateTicket()
  // `null` while WhatsApp support is off: the tile is hidden, as on Contact us (public-site.md, #277).
  const whatsapp = useWhatsappNumber()
  const [type, setType] = useState<ProblemType>('late')
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState<string | null>(null)

  const wanted = params.get('order')
  const about = (wanted && orders.data?.find((o) => o.reference === wanted)) || orders.data?.find((o) => isActiveStage(o.stage)) || orders.data?.[0]
  const sentQuote = params.get('sent') === 'quote'

  function send() {
    if (message.trim().length < 3) {
      setMessageError('Tell us what happened.')
      return
    }
    create.mutate(
      { type, message: message.trim(), reference: about?.reference ?? null },
      { onSuccess: () => setMessage('') },
    )
  }

  return (
    <MobileShell>
      <TopBar left={<BackLink to="/menu" />} center={<TopBarTitle>Support</TopBarTitle>} right={<TopBarSpacer />} />
      <ScrollArea className="gap-3">
        {sentQuote && (
          <Notice tone="success">
            Your quote request is sent. Our team will call you with a price. Nothing is booked until you agree to it.
          </Notice>
        )}
        <div className="rise-1 relative min-h-[120px] overflow-hidden rounded-[22px] bg-[#E6F3F5]">
          <Illustration name="drop-hero" className="absolute top-0 right-[-60px] h-full w-auto max-w-none" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(234,243,254,.97)_45%,rgba(234,243,254,0)_80%)]" />
          <div className="relative max-w-[210px] p-[18px]">
            <div className="text-[22px] leading-[1.15] font-extrabold">How can we help?</div>
            <p className="mt-[3px] mb-0 text-sub text-slate">Call or message our team.</p>
          </div>
        </div>
        <div className={cx('rise-2 grid gap-2.5', whatsapp ? 'grid-cols-3' : 'grid-cols-2')}>
          <ActionTile to="/support/contact#call" icon={<IconBadge tone="green"><PhoneIcon size={20} /></IconBadge>} label="Call us" />
          {whatsapp && (
            <ActionTile to="/support/contact#whatsapp" icon={<IconBadge tone="teal"><MessageCircleIcon size={20} /></IconBadge>} label="WhatsApp" />
          )}
          <ActionTile to="/support/contact#chat" icon={<IconBadge tone="blue"><MessageSquareIcon size={20} /></IconBadge>} label="Chat" />
        </div>
        <Card pad className="rise-3">
          <SectionTitle>Report a problem</SectionTitle>
          <p className="mt-[3px] mb-2.5 text-sub text-mute">
            {about ? `About ${shortReference(about.reference)} · ${orderQuantityText(about)}` : 'About your account'}
          </p>
          <div role="radiogroup" aria-label="Problem type" className="flex flex-wrap gap-2">
            {TYPES.map((t) => {
              const on = t === type
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setType(t)}
                  className={cx('mo-pill hit-44', on ? 'border-0 bg-ink text-white' : 'border-[1.5px] border-solid border-line bg-white text-slate hover:border-primary hover:text-ink')}
                >
                  {PROBLEM_LABEL[t]}
                </button>
              )
            })}
          </div>
          <TextAreaField
            className="mt-3"
            label="Tell us more"
            placeholder="What happened?"
            rows={3}
            value={message}
            maxLength={1000}
            error={messageError ?? undefined}
            onChange={(e) => {
              setMessage(e.target.value)
              setMessageError(null)
            }}
          />
          {create.isSuccess && (
            <Notice tone="success" className="mt-3">
              Sent. Your request is {create.data.number}. We will reply by SMS or call.
            </Notice>
          )}
          {create.isError && (
            <Notice tone="error" className="mt-3">
              {errorMessage(create.error)}
            </Notice>
          )}
          <Button className="mt-3" onClick={send} loading={create.isPending}>
            Send to support
          </Button>
        </Card>
        {tickets.isPending && <LoadingBlock lines={1} label="Loading your requests" />}
        {tickets.isError && <ErrorBlock error={tickets.error} onRetry={() => tickets.refetch()} />}
        {tickets.data && tickets.data.length > 0 && (
          <Card className="rise-4 px-3.5 py-1">
            {tickets.data.map((t) => (
              <div key={t.id} className="mo-li">
                <IconBadge tone={t.kind === 'problem' ? 'gold' : 'blue'} size={36}>
                  <span aria-hidden="true" className="font-extrabold">
                    {t.kind === 'problem' ? '!' : '?'}
                  </span>
                </IconBadge>
                <div className="flex-1">
                  <div className="text-sub font-bold">
                    {t.number} · {t.title}
                  </div>
                  <div className="text-chip text-mute">
                    {formatShortDate(t.at)}
                    {t.note ? ` · ${t.note}` : ''}
                  </div>
                </div>
                <Chip tone={t.status === 'resolved' ? 'green' : 'amber'} className="px-2 py-[3px]">
                  {t.status === 'resolved' ? 'Resolved' : 'Open'}
                </Chip>
              </div>
            ))}
          </Card>
        )}
      </ScrollArea>
    </MobileShell>
  )
}
