import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Wave } from '../../../../components/art/Art'
import { Illustration } from '../../../../components/brand/Illustration'
import { BanknoteIcon, CheckIcon, MapPinIcon, PhoneIcon } from '../../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar } from '../../../../components/layout/MobileShell'
import { ErrorBlock } from '../../../../components/layout/StateScreens'
import { Button, ButtonLink } from '../../../../components/ui/Button'
import { Card } from '../../../../components/ui/Card'
import { SampleTag } from '../../../../components/ui/Chip'
import { KeyValue, SectionHeader, TextLink } from '../../../../components/ui/Content'
import { Notice } from '../../../../components/ui/Notice'
import { WATER_SOURCE_LABEL, describeChoice, describeTankSize, kekeTotalLitres } from '../../../../domain/orders'
import { describeQuantity } from '../../../../domain/quantity'
import { parseGallons } from '../../../../domain/tankCapacity'
import { ApiError } from '../../../../lib/api/client'
import { errorMessage } from '../../../../lib/api/errorMessage'
import { USE_MOCKS } from '../../../../lib/api/mode'
import { formatTime } from '../../../../lib/format/datetime'
import { formatNaira } from '../../../../lib/format/money'
import { formatPhone, normalizeNigerianPhone } from '../../../../lib/format/phone'
import { useSession } from '../../../auth/useSession'
import { OrderStepHeading } from '../../components/OrderParts'
import { VerifyPhoneBanner } from '../../components/VerifyPhoneBanner'
import { draftChoice } from '../../order/draft'
import { isPriceExpired, noPriceMessage, priceProblem, type PriceProblem, type PriceRequest } from '../../order/livePrice'
import { useOrderDraft } from '../../order/orderDraftContext'
import { useAddresses, useCreateOrder, useCreateTicket, useProfile, useQuote } from '../../queries'

/**
 * The current time, refreshed at the next deadline (a price's expiry, the end
 * of a wait) and every 30 seconds while one is ahead, so the screen changes
 * when a price expires without fetching anything (no automatic new price,
 * decision 4).
 */
function useClock(deadlines: (number | null)[]): number {
  const [now, setNow] = useState(() => Date.now())
  const next = deadlines.filter((d): d is number => d !== null && d > now).sort((a, b) => a - b)[0] ?? null
  useEffect(() => {
    if (next === null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - Date.now(), 30_000) + 50)
    return () => clearTimeout(timer)
  }, [next, now])
  return now
}

/**
 * Review and place the order (`c-review`; customer-live-prices.md, screen 5).
 * The server prices the order once the address and area are known (FR-022,
 * #42) and the customer sees the total only. Without a price in the app the
 * order goes as a request ("Send request"), and the office calls with the
 * price (FR-022 manual fallback). Every message is the approved wording.
 */
export function Review() {
  const navigate = useNavigate()
  const { draft, reset } = useOrderDraft()
  const profile = useProfile()
  const session = useSession()
  // FR-003: no water request until the phone is verified (docs/design/phone-verification.md, E3).
  const unverified = Boolean(session.data && !session.data.user.phone_verified)
  const addresses = useAddresses()
  const createOrder = useCreateOrder()
  const requestTicket = useCreateTicket()
  const choice = draftChoice(draft)
  // Set when the order succeeds, before the draft is cleared, so the redirects
  // below cannot fire while we leave this page.
  const [finished, setFinished] = useState(false)
  // What a "Try again" after a lost connection repeats.
  const [lastAction, setLastAction] = useState<'place' | 'request'>('place')

  const saved = draft.address_id ? addresses.data?.find((a) => a.id === draft.address_id) : undefined
  const newZone = draft.new_address.zone
  const address = saved
    ? { label: saved.label, address: saved.address, landmark: saved.landmark }
    : draft.new_address.address
      ? { label: draft.new_address.label || 'Delivery address', address: draft.new_address.address, landmark: draft.new_address.landmark || null }
      : null
  // The area for the price: a saved address's own (even if no longer served:
  // the server then answers outside_service_zone, decision 2), or the one
  // picked for the new address; none for "My area is not listed".
  const area = saved ? (saved.zone ?? null) : newZone && newZone !== 'not_listed' ? newZone : null
  const areaPicked = Boolean(saved) || newZone !== null
  const customGallons = choice.delivery_type === 'tanker' && choice.tank_size_gallons === null ? parseGallons(draft.tanker.custom_gallons) : null
  const request: PriceRequest | null =
    address && areaPicked ? { choice, address: address.address, zone_id: area?.id ?? null, custom_gallons: customGallons } : null
  const quote = useQuote(request)
  const receiverName = draft.receiver_name || profile.data?.name || ''
  const receiverPhone = draft.receiver_phone || (profile.data ? formatPhone(profile.data.phone) : '')

  const q = quote.data?.status === 'quote_available' ? quote.data : undefined
  const manual = quote.data?.status === 'manual_quote_required' ? quote.data : undefined
  const placeProblem = createOrder.isError ? priceProblem(createOrder.error) : null
  const quoteProblem = quote.isError ? priceProblem(quote.error) : null
  const problem: PriceProblem | null = placeProblem ?? quoteProblem
  const waitUntil =
    problem?.next === 'wait' ? (placeProblem ? createOrder.submittedAt : quote.errorUpdatedAt) + (problem.wait_seconds ?? 0) * 1000 : null
  const now = useClock([q ? Date.parse(q.price_valid_until) : null, waitUntil])
  const expired = q ? isPriceExpired(q.price_valid_until, now) : false
  const waiting = waitUntil !== null && waitUntil > now

  if (!finished && addresses.isSuccess && !address) return <Navigate to={addresses.data.length ? '/order/address' : '/order/details'} replace />
  if (!finished && address && !areaPicked) return <Navigate to="/order/details" replace />

  const editPath = draft.delivery_type === 'keke' ? '/order/keke' : '/order/tanker'
  const litres = q?.quantity_litres ?? (choice.delivery_type === 'keke' ? kekeTotalLitres(choice) : null)

  function place(quoteId: string | null) {
    if (!address) return
    setLastAction(quoteId === null && !q ? 'request' : 'place')
    createOrder.mutate(
      {
        idempotency_key: draft.idempotency_key,
        choice,
        address_label: address.label,
        address: address.address,
        landmark: address.landmark,
        receiver_name: receiverName,
        receiver_phone: normalizeNigerianPhone(receiverPhone) ?? receiverPhone,
        instructions: draft.instructions || null,
        custom_gallons: customGallons,
        quote_id: quoteId,
        service_zone_id: area?.id ?? null,
      },
      {
        onSuccess: (order) => {
          setFinished(true)
          reset()
          navigate(`/orders/${order.reference}/placed`, { replace: true })
        },
        onError: (error) => {
          // The new price straight away (decision 4: the customer was already acting).
          if (error instanceof ApiError && (error.code === 'quote_expired' || error.code === 'quote_mismatch')) void quote.refetch()
        },
      },
    )
  }

  /** Send the order without a price: a quote request, and the office calls (FR-022 manual fallback). */
  function sendRequest() {
    if (!address) return
    setLastAction('request')
    if (!USE_MOCKS) {
      place(null)
      return
    }
    // The mock has no quote requests (its orders always carry a price), so the
    // demo sends the request to support, as before #121.
    const what =
      choice.delivery_type === 'keke'
        ? describeChoice(choice)
        : `${describeTankSize(choice.tank_size_gallons, draft.tanker.custom_gallons) ?? 'size not given'}, ${choice.tank_type} tank, ${WATER_SOURCE_LABEL[choice.source]}`
    requestTicket.mutate(
      { type: 'other', reference: null, message: `Price request: ${what}, to ${address.address}. Receiver ${receiverName}, ${receiverPhone}.` },
      {
        onSuccess: () => {
          setFinished(true)
          reset()
          navigate('/support?sent=quote', { replace: true })
        },
      },
    )
  }

  const busy = createOrder.isPending || requestTicket.isPending
  const blocked = unverified || !address
  const footer = footerAction()

  /** The footer button for the current state (design: "Review", button per state). */
  function footerAction(): { label: string; onClick?: () => void; disabled?: boolean } {
    if (problem) {
      switch (problem.next) {
        case 'new_price':
          // The new price may come back as no price in the app: then it goes as a request.
          if (manual && !quote.isFetching) return { label: 'Send request', onClick: sendRequest, disabled: blocked }
          return q && !quote.isFetching
            ? { label: `Place order · ${formatNaira(q.total_minor_units)}`, onClick: () => place(q.quote_id), disabled: blocked }
            : { label: 'Place order', disabled: true }
        case 'send_request':
          return { label: 'Send request', onClick: sendRequest, disabled: blocked }
        case 'choose_area':
          return { label: 'Choose your area', onClick: () => navigate(saved ? '/order/details?new=1' : '/order/details') }
        case 'wait':
          return waiting
            ? { label: `Try again in ${Math.max(1, Math.ceil(((waitUntil ?? now) - now) / 60_000))} min`, disabled: true }
            : { label: 'Try again', onClick: () => void quote.refetch() }
        case 'retry':
          if (placeProblem) return { label: 'Try again', onClick: lastAction === 'request' ? sendRequest : () => place(q?.quote_id ?? null), disabled: blocked }
          return { label: 'Try again', onClick: () => void quote.refetch() }
      }
    }
    if (manual) return { label: 'Send request', onClick: sendRequest, disabled: blocked }
    if (q && expired) return { label: 'Get a new price', onClick: () => void quote.refetch(), disabled: quote.isFetching }
    if (q) return { label: `Place order · ${formatNaira(q.total_minor_units)}`, onClick: () => place(q.quote_id), disabled: blocked }
    return { label: 'Place order', disabled: true }
  }

  const otherPlaceError = (createOrder.isError && !placeProblem) || requestTicket.isError
  const placeError = createOrder.error ?? requestTicket.error

  return (
    <MobileShell>
      <TopBar left={<BackLink to={saved ? '/order/address' : '/order/save-address'} />} />
      <ScrollArea className="gap-3">
        <OrderStepHeading step={4} title="Review your order" sub="Check everything before you place it." />
        <VerifyPhoneBanner from="/order/review" className="rise-1" />
        <Card pad className="rise-2">
          <SectionHeader
            title={choice.delivery_type === 'keke' ? 'Keke delivery' : 'Tanker delivery'}
            action={<TextLink to={editPath} className="text-label">Edit</TextLink>}
          />
          <div className="mt-1.5 flex items-center gap-3">
            <Illustration name={choice.delivery_type} className="animate-drive h-auto w-28 shrink-0" />
            <div className="flex-1">
              {choice.delivery_type === 'keke' ? (
                <>
                  <KeyValue label="Water size" value={`${choice.can_size_litres} litres per can`} />
                  <KeyValue label="Quantity" value={`${choice.can_count} cans`} />
                </>
              ) : (
                <>
                  <KeyValue label="Tank" value={choice.tank_type === 'ground' ? 'Ground tank' : 'Overhead tank'} />
                  <KeyValue label="Capacity" value={describeTankSize(choice.tank_size_gallons, draft.tanker.custom_gallons) ?? 'Custom size'} />
                  <KeyValue label="Source" value={WATER_SOURCE_LABEL[choice.source]} />
                </>
              )}
              {/* The server's litres once priced (FR-021: the client shows this value, not its own). */}
              {litres !== null && <KeyValue label="Total water" value={describeQuantity(litres)} />}
            </div>
          </div>
        </Card>

        <Card pad className="rise-3">
          <SectionHeader title="Delivery address" action={<TextLink to="/order/details" className="text-label">Edit</TextLink>} />
          {address && (
            <div className="mt-2 flex gap-2.5">
              <MapPinIcon size={20} color="#11708C" className="mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">{address.address}</div>
                {address.landmark && <div className="text-caption text-mute">Landmark: {address.landmark}</div>}
                <div className="text-caption text-mute">Area: {area ? area.name : 'not listed'}</div>
                <div className="text-caption text-mute">
                  {receiverName} · {receiverPhone}
                </div>
              </div>
            </div>
          )}
        </Card>

        {quote.isPending && request && (
          <Card pad aria-busy="true" className="rise-4 flex flex-col gap-2.5">
            <span className="text-sub font-bold text-mute">Getting your price…</span>
            <div aria-hidden="true" className="skeleton h-7.5 w-[55%] rounded-badge bg-segment" />
            <div aria-hidden="true" className="skeleton h-3.5 w-[80%] rounded-badge bg-segment" />
          </Card>
        )}

        {q && (
          <div
            className={
              expired
                ? 'rise-4 flex flex-col gap-1 rounded-card bg-[#56677D] p-4 text-white'
                : 'rise-4 relative flex flex-col gap-1 overflow-hidden rounded-card bg-[linear-gradient(135deg,#0E4A5A_0%,#11708C_60%,#16A0B8_100%)] p-4 text-white'
            }
          >
            <div className="flex items-center justify-between">
              <span className="text-sub font-bold opacity-85">Total to pay</span>
              {q.is_sample && <SampleTag />}
            </div>
            <span className={expired ? 'text-[30px] font-extrabold tracking-[-1px] line-through opacity-70' : 'text-[30px] font-extrabold tracking-[-1px]'}>
              {formatNaira(q.total_minor_units)}
            </span>
            {/* No supported-uses text: the category label alone, nothing invented (FR-014, decision 5). */}
            {q.category && (
              <span className="text-label font-bold">
                {q.category.label}
                {q.category.supported_uses && <span className="block font-semibold opacity-90">{q.category.supported_uses}</span>}
              </span>
            )}
            <span className={expired ? 'mt-1.5 text-caption font-bold text-[#FFF4D6]' : 'mt-1.5 text-caption font-bold opacity-90'}>
              {expired
                ? `This price expired at ${formatTime(q.price_valid_until)}. Get a new price to continue.`
                : `Price valid until ${formatTime(q.price_valid_until)}`}
            </span>
            {!expired && <Wave fill="#FFFFFF" variant="low" height={34} className="bottom-[-12px] opacity-20" />}
          </div>
        )}

        {/* FR-023 before confirming: pay on delivery (F4), window by call (F3), no charges (F5). */}
        {q && !expired && (
          <Card pad className="rise-5 flex flex-col gap-2.5 text-sub">
            <span className="flex items-start gap-2.5">
              <BanknoteIcon size={18} color="#15803D" className="mt-px shrink-0" />
              <span>
                <b>Pay on delivery.</b> Cash after the water is unloaded.
              </span>
            </span>
            <span className="flex items-start gap-2.5">
              <PhoneIcon size={18} color="#11708C" className="mt-px shrink-0" />
              <span>We'll call you to agree the delivery time. Nothing is booked until then.</span>
            </span>
            <span className="flex items-start gap-2.5">
              <CheckIcon size={18} color="#56677D" className="mt-px shrink-0" />
              <span>No charge to cancel or redeliver.</span>
            </span>
          </Card>
        )}

        {manual && placeProblem?.next !== 'send_request' && (
          <Notice className="rise-4">
            <b className="block">{noPriceMessage(manual.reason).title}</b>
            {noPriceMessage(manual.reason).body}
            <span className="mt-1 block text-caption">We'll call you to agree the price and the delivery time. No charge to cancel.</span>
          </Notice>
        )}

        {problem && (
          <Notice tone={problem.tone}>
            <b className="block">{problem.title}</b>
            {problem.body}
          </Notice>
        )}
        {quote.isError && !quoteProblem && <ErrorBlock error={quote.error} onRetry={() => quote.refetch()} />}

        {otherPlaceError &&
          (placeError instanceof ApiError && placeError.code === 'phone_not_verified' ? (
            <Notice tone="error">
              <b>Verify your phone number first.</b> You need a verified number to place an order. Your details are kept.
              <span className="mt-2 block">
                <ButtonLink to="/verify-phone" state={{ from: '/order/review' }} size="sm" block={false}>
                  Verify phone
                </ButtonLink>
              </span>
            </Notice>
          ) : (
            <Notice tone="error">{errorMessage(placeError)} Your details are kept; you can try again.</Notice>
          ))}
      </ScrollArea>
      <Footer>
        <Button onClick={footer.onClick} loading={busy} disabled={footer.disabled}>
          {footer.label}
        </Button>
      </Footer>
    </MobileShell>
  )
}
