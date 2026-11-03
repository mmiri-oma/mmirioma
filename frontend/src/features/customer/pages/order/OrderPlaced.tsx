import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Confetti, MapPin, PlacedRouteArt } from '../../../../components/art/Art'
import { Illustration } from '../../../../components/brand/Illustration'
import { CheckIcon, CopyIcon } from '../../../../components/icons/icons'
import { MobileShell, ScrollArea } from '../../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../../components/layout/StateScreens'
import { ButtonLink } from '../../../../components/ui/Button'
import { Card } from '../../../../components/ui/Card'
import { Chip } from '../../../../components/ui/Chip'
import { KeyValue, Separator } from '../../../../components/ui/Content'
import { IconButton } from '../../../../components/ui/IconButton'
import { Notice } from '../../../../components/ui/Notice'
import { STAGE_LABEL } from '../../../../domain/orders'
import { PRICE_PENDING, orderQuantityText } from '../../orderHelpers'
import { formatNaira } from '../../../../lib/format/money'
import { StageChip } from '../../components/OrderBits'
import { useOrder } from '../../queries'

const CONFETTI = [
  { left: 40, top: 10, color: '#11708C', delay: 0 },
  { left: 96, top: 0, color: '#F2B33D', delay: 0.4 },
  { left: 150, top: 20, color: '#22C55E', delay: 0.9 },
  { left: 236, top: 4, color: '#16A0B8', delay: 0.2 },
  { left: 300, top: 16, color: '#F2B33D', delay: 1.2 },
  { left: 340, top: 0, color: '#11708C', delay: 0.7 },
]

/**
 * Order placed (`c-confirmed`). Never says the order is confirmed or
 * guaranteed (FR-027): a priced order is "Awaiting confirmation" and a
 * request is "Request received" (customer-live-prices.md, screen 6).
 */
export function OrderPlaced() {
  const { reference } = useParams()
  const order = useOrder(reference)
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!reference) return
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const o = order.data
  // Before confirmation (customer-live-prices.md, screen 6): a priced order or
  // a request, never "finding a rider" (FR-027). The mock's orders go straight
  // to `waiting_rider` and keep the original screen.
  const priced = o?.stage === 'awaiting_confirmation'
  const request = o?.stage === 'request_received'
  const unconfirmed = priced || request
  const heading = priced ? 'Order received' : request ? 'Request received' : 'Order placed!'
  const sub = priced
    ? 'Your price is held on this order. Our team confirms it with you before delivery.'
    : request
      ? "We're preparing your price."
      : 'We are finding a rider near you. You will see them here the moment one accepts.'
  return (
    <MobileShell className="bg-[linear-gradient(180deg,#E9F8EF_0%,#F4F7FB_42%)]">
      <Confetti pieces={CONFETTI} height={220} />
      <ScrollArea className="items-center gap-3 pt-10 text-center">
        <div className="relative flex size-[120px] shrink-0 items-center justify-center" aria-hidden="true">
          <span className="animate-ping absolute size-20 rounded-full bg-[rgba(34,197,94,.3)]" />
          <span className="animate-pop flex size-[84px] items-center justify-center rounded-full bg-[#16A34A] shadow-[0_14px_30px_rgba(22,163,74,0.35)]">
            <CheckIcon size={42} strokeWidth={3} color="#fff" />
          </span>
        </div>
        <h1 className="rise-1 m-0 text-[26px] font-extrabold tracking-[-0.5px] text-green">{heading}</h1>
        <p className="rise-2 m-0 max-w-[290px] text-sub text-mute">{sub}</p>
        {order.isPending && <LoadingBlock lines={1} label="Loading your order" />}
        {order.isError && <ErrorBlock error={order.error} onRetry={() => order.refetch()} />}
        {o && (
          <Card pad className="rise-3 box-border w-full text-left">
            <div className="flex items-center justify-between gap-2.5">
              <div>
                <div className="text-chip text-mute">Order number</div>
                <div className="text-[19px] font-extrabold tracking-[0.3px]">{o.reference}</div>
              </div>
              <IconButton tone="soft" label={copied ? 'Order number copied' : 'Copy order number'} onClick={copy}>
                {copied ? <CheckIcon size={20} /> : <CopyIcon size={20} />}
              </IconButton>
            </div>
            <span className="sr-only" aria-live="polite">
              {copied ? 'Order number copied' : ''}
            </span>
            <Separator />
            {o.choice && <KeyValue label="Delivery type" value={o.choice.delivery_type === 'keke' ? 'Keke delivery' : 'Tanker delivery'} />}
            <KeyValue label="Water" value={orderQuantityText(o)} />
            {o.quote?.category_label && <KeyValue label="Water category" value={o.quote.category_label} />}
            <KeyValue label={o.quote?.is_sample ? 'Total (sample)' : 'Total'} value={o.quote ? formatNaira(o.quote.total_minor_units) : PRICE_PENDING} />
            <div className="flex items-center justify-between gap-2.5 py-[3px] text-sub">
              <span className="text-mute">Status</span>
              {o.stage === 'waiting_rider' ? (
                <Chip tone="amber">
                  <span aria-hidden="true" className="animate-ping relative size-2 rounded-full bg-[#D97706] [animation-duration:1.4s]" />
                  {STAGE_LABEL.waiting_rider}
                </Chip>
              ) : (
                <StageChip stage={o.stage} />
              )}
            </div>
            {unconfirmed && <p className="mt-1.5 mb-0 text-caption text-mute">Pay on delivery: cash after the water is unloaded.</p>}
          </Card>
        )}
        {unconfirmed && (
          <Notice tone="info" className="rise-4 w-full text-left">
            {priced
              ? "We'll call you to agree the delivery time. No charge to cancel or redeliver."
              : "We'll call you with the price and to agree the delivery time."}
          </Notice>
        )}
        <div className="rise-4 flex w-full flex-col gap-2">
          {unconfirmed ? (
            <ButtonLink to={`/orders/${reference}`}>View my order</ButtonLink>
          ) : (
            <ButtonLink to={`/orders/${reference}/track`}>Track delivery</ButtonLink>
          )}
          <ButtonLink to="/home" variant="alt">
            Back to home
          </ButtonLink>
        </div>
        <div className="rise-5 relative mt-1 h-[92px] w-full shrink-0" aria-hidden="true">
          <PlacedRouteArt />
          <Illustration name="keke" className="animate-drive absolute bottom-1 left-0 w-[92px]" />
          <MapPin color="#16A34A" ringColor="rgba(34,197,94,.4)" width={30} height={38} ringSize={16} className="absolute top-2.5 right-3" />
        </div>
      </ScrollArea>
    </MobileShell>
  )
}
