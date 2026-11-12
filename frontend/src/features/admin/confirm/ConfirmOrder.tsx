import { useState, type ReactNode } from 'react'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { RadioRow } from '../../../components/ui/Choice'
import { Chip } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { KeyValue } from '../../../components/ui/Content'
import { TextAreaField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { AlertCircleIcon } from '../../../components/icons/icons'
import { choiceFromRead } from '../../customer/real/order'
import { describeChoice } from '../../../domain/orders'
import { describeQuantity } from '../../../domain/quantity'
import { AGREEMENT_METHODS, type AgreementMethod } from '../../../lib/api/confirmationTypes'
import type { AdminOrderDetail } from '../../../lib/api/adminDispatch'
import { errorMessage } from '../../../lib/api/errorMessage'
import { formatCalendarDate } from '../../../lib/format/datetime'
import { formatNaira, nairaInputToKobo } from '../../../lib/format/money'
import { formatPhone } from '../../../lib/format/phone'
import { cx } from '../../../lib/cx'
import {
  AGREEMENT_LABEL,
  KIND_CHIP,
  C1_REASON_LABEL,
  SOURCE_KIND_LABEL,
  buildConfirmRequest,
  confirmKind,
  confirmProblem,
  formErrors,
  formatWindow,
  lagosNowTime,
  lagosToday,
  requiredSourceKind,
  sourcesFor,
  usableCategories,
  type ConfirmForm,
  type ConfirmKind,
} from './logic'
import { SideSheet } from './SideSheet'
import { useConfirmDetail, useConfirmOrder, useConfirmationOptions, useRefreshOptions } from './queries'

/** The "Server price" / "Manual price" chip (design decision 5). */
export function PriceChip({ kind }: { kind: ConfirmKind }) {
  return <Chip tone={kind === 'server' ? 'blue' : 'gold'}>{KIND_CHIP[kind]}</Chip>
}

function quantityText(detail: AdminOrderDetail): string {
  const choice = choiceFromRead(detail)
  return choice ? `${choice.delivery_type === 'keke' ? 'Keke' : 'Tanker'} · ${describeChoice(choice)}` : describeQuantity(detail.quantity_litres, 'litres', 'short')
}

/**
 * Q0: the panel card for an order awaiting confirmation (a priced order or a
 * price request), with "Confirm order". Opens the sheet; tells the page once
 * the order is confirmed, with the toast text.
 */
export function ConfirmCard({ reference, onConfirmed }: { reference: string; onConfirmed: (message: string) => void }) {
  const detail = useConfirmDetail(reference)
  const [open, setOpen] = useState(false)
  const d = detail.data
  if (detail.isPending) return <Card className="p-4"><LoadingBlock lines={2} label="Loading the order" /></Card>
  if (detail.isError || !d) return <Card className="p-4"><ErrorBlock error={detail.error} onRetry={() => detail.refetch()} /></Card>
  const kind = confirmKind(d)
  if (!kind) return null
  const verified = d.customer.phone_verified
  return (
    <Card className="rise-2 flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[20px] font-extrabold">Confirm this order</h2>
        <Chip tone="amber">Awaiting confirmation</Chip>
      </div>
      <div className="flex justify-between gap-2 text-sub">
        <b>{d.reference}</b>
        <span className="text-right text-mute">{quantityText(d)}</span>
      </div>
      {kind === 'server' && d.quote ? (
        <div className="flex flex-col gap-1 rounded-option bg-sky px-3.5 py-3">
          <span className="self-start"><PriceChip kind="server" /></span>
          <span className="text-[24px] font-extrabold text-primary-dark">{formatNaira(d.quote.total_minor_units)}</span>
          <span className="text-label font-bold">{d.quote.water_category.label}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-option bg-[#FFF7E2] px-3.5 py-3 text-[#5A4310]">
          <span className="self-start"><Chip tone="gold">Price request</Chip></span>
          <span className="text-sub">No price yet: agree the total on the call.</span>
        </div>
      )}
      <p className="m-0 text-sub text-slate">Agree the delivery window with the customer, then choose a water source.</p>
      {!verified && (
        <Notice tone="error">
          <b className="block">Phone not verified</b>
          The customer must verify their phone before the order can be confirmed.
        </Notice>
      )}
      <Button disabled={!verified} onClick={() => setOpen(true)}>
        Confirm order
      </Button>
      {open && (
        <ConfirmSheet
          detail={d}
          kind={kind}
          onClose={() => setOpen(false)}
          onConfirmed={(message) => {
            setOpen(false)
            onConfirmed(message)
          }}
        />
      )}
    </Card>
  )
}

function Section({ title, aside, id, error, children }: { title: string; aside?: ReactNode; id?: string; error?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className={cx('flex flex-col gap-2 rounded-card border bg-white px-4 py-3.5 text-sub', error ? 'border-red' : 'border-card-line')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-extrabold">{title}</h3>
        {aside}
      </div>
      {children}
      {error && (
        <p role="alert" className="m-0 font-bold text-red">
          {error}
        </p>
      )}
    </section>
  )
}

/** Q1-Q3: the confirm sheet, the confirm dialog and the errors after sending. */
function ConfirmSheet({
  detail,
  kind,
  onClose,
  onConfirmed,
}: {
  detail: AdminOrderDetail
  kind: ConfirmKind
  onClose: () => void
  onConfirmed: (message: string) => void
}) {
  const options = useConfirmationOptions(detail.reference, true)
  const refreshOptions = useRefreshOptions(detail.reference)
  const confirm = useConfirmOrder(detail.reference)
  const quoteCategoryId = kind === 'server' ? (detail.quote?.water_category.id ?? null) : null
  const [form, setForm] = useState<ConfirmForm>({
    categoryId: quoteCategoryId,
    sourceId: null,
    // The preferred date is a hint, never a default (upstream C1).
    date: '',
    from: '',
    to: '',
    total: '',
    method: 'phone_call',
    agreedDate: lagosToday(),
    agreedTime: lagosNowTime(),
    told: false,
    note: '',
  })
  // After the first "Confirm order", the checks run on every change, so a fixed section clears.
  const [checked, setChecked] = useState(false)
  const [asking, setAsking] = useState(false)
  const set = (patch: Partial<ConfirmForm>) => setForm((f) => ({ ...f, ...patch }))

  const categories = options.data ?? []
  const noneSetUp = options.isSuccess && categories.every((c) => c.sources.length === 0)
  const usableCats = usableCategories(categories)
  // A price request preselects the first category with a usable source (upstream C1).
  const categoryId = kind === 'manual' ? (form.categoryId ?? usableCats[0]?.id ?? null) : quoteCategoryId
  const category = categories.find((c) => c.id === categoryId)
  const requiredKind = requiredSourceKind(detail, kind)
  const { usable, unusable } = sourcesFor(category, requiredKind)
  const problem = confirm.isError ? confirmProblem(confirm.error) : null
  const effective: ConfirmForm = { ...form, categoryId }
  const errors = { ...(checked ? formErrors(effective, kind) : {}), ...(problem?.fields ?? {}) }

  function review() {
    setChecked(true)
    if (Object.keys(formErrors(effective, kind)).length === 0) setAsking(true)
  }

  function send() {
    confirm.mutate(buildConfirmRequest(effective, kind), {
      onSuccess: (order) => {
        setAsking(false)
        const w = order.delivery_window
        onConfirmed(w ? `${order.reference} confirmed for ${formatWindow(w.start_at, w.end_at)}.` : `${order.reference} confirmed.`)
      },
      onError: (error) => {
        setAsking(false)
        const p = confirmProblem(error)
        if (p?.next === 'refresh_sources') {
          set({ sourceId: null })
          void refreshOptions()
        }
      },
    })
  }

  const summaryErrors = Object.values(errors).filter(Boolean)
  const kobo = kind === 'manual' ? nairaInputToKobo(form.total) : (detail.quote?.total_minor_units ?? null)
  const source = usable.find((s) => s.id === form.sourceId)

  return (
    <SideSheet
      title="Confirm order"
      sub={
        <>
          {detail.reference} · <b>{KIND_CHIP[kind]}</b>
        </>
      }
      locked={confirm.isPending || asking}
      onClose={onClose}
      footer={
        <>
          <Button variant="line" block={false} className="px-5" disabled={confirm.isPending} onClick={onClose}>
            Cancel
          </Button>
          {!noneSetUp && (
            <Button block={false} className="px-6" disabled={!options.isSuccess || (kind === 'server' && !quoteCategoryId)} onClick={review}>
              Confirm order
            </Button>
          )}
        </>
      }
    >
      {problem && (
        <Notice tone={problem.tone}>
          <b className="block">{problem.title}</b>
          {problem.lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
          {problem.next === 'refresh_order' && (
            <span className="mt-2 block">
              <Button variant="line" size="sm" block={false} onClick={onClose}>
                Refresh
              </Button>
            </span>
          )}
          {problem.next === 'reload' && (
            <span className="mt-2 block">
              <Button variant="line" size="sm" block={false} onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </span>
          )}
        </Notice>
      )}
      {confirm.isError && !problem && <Notice tone="error">{errorMessage(confirm.error)} Everything you entered is kept.</Notice>}
      {checked && summaryErrors.length > 0 && !problem && (
        <Notice tone="error">
          <b className="block">Check {summaryErrors.length === 1 ? '1 thing' : `${summaryErrors.length} things`} before you confirm</b>
          {summaryErrors.map((e) => (
            <span key={e} className="block">
              {e}
            </span>
          ))}
        </Notice>
      )}
      {kind === 'server' && !quoteCategoryId && (
        <Notice tone="error">
          This order cannot be confirmed from the app yet: the server did not send its price's water category. Update the server, then try again.
        </Notice>
      )}

      {options.isPending && <LoadingBlock lines={3} label="Loading the water sources" />}
      {options.isError && <ErrorBlock error={options.error} onRetry={() => options.refetch()} />}
      {noneSetUp && (
        <Card pad className="flex flex-col gap-1">
          <b className="text-[16px]">No water sources set up yet.</b>
          <span className="text-sub text-mute">Ask the technical lead to add water sources.</span>
        </Card>
      )}
      {options.isSuccess && !noneSetUp && kind === 'manual' && usableCats.length === 0 && (
        <Card pad className="flex flex-col gap-1">
          <b className="text-[16px]">This order cannot be confirmed yet.</b>
          <span className="text-sub text-mute">No water source can be used for any water category. Ask the technical lead to activate a source.</span>
        </Card>
      )}

      {options.isSuccess && !noneSetUp && (
        <>
          <Section title="1 Order">
            <KeyValue label="Order" value={<b>{detail.reference}</b>} />
            <KeyValue label="Quantity" value={quantityText(detail)} />
            <KeyValue label="Deliver to" value={detail.delivery_address} />
            <KeyValue label="Area" value={detail.service_zone?.name ?? 'Not listed'} />
            {detail.landmark && <KeyValue label="Landmark" value={detail.landmark} />}
            <KeyValue
              label="Customer"
              value={
                <span>
                  {detail.customer.name} · <a href={`tel:${detail.customer.phone}`}>{formatPhone(detail.customer.phone)}</a>
                </span>
              }
            />
            <KeyValue label="Preferred date" value={detail.preferred_delivery_date ? formatCalendarDate(detail.preferred_delivery_date) : 'No preferred date'} />
          </Section>

          <Section title="2 Checks">
            <KeyValue label="Phone verified" value={<Chip tone={detail.customer.phone_verified ? 'green' : 'red'}>{detail.customer.phone_verified ? 'Done' : 'Not met'}</Chip>} />
            <KeyValue label="Pay on delivery" value={<span className="text-mute">Cash after unloading</span>} />
          </Section>

          <Section id="confirm-price" title="3 Price" aside={<PriceChip kind={kind} />} error={errors.price}>
            {kind === 'server' && detail.quote ? (
              <>
                <span className="text-[26px] font-extrabold text-primary-dark">{formatNaira(detail.quote.total_minor_units)}</span>
                <span className="text-mute">The price the customer accepted in the app. It is fixed for this order.</span>
              </>
            ) : (
              <>
                <TextField
                  label="Total agreed on the call (₦)"
                  inputMode="numeric"
                  placeholder="e.g. 45,000"
                  value={form.total}
                  onChange={(e) => set({ total: e.target.value.replace(/[^\d,]/g, '') })}
                />
                {kobo !== null && kobo >= 100 && <span className="font-bold">{formatNaira(kobo)}</span>}
                <span className="text-mute">Whole naira only. The customer pays this in cash after unloading.</span>
              </>
            )}
          </Section>

          <Section title="4 Water category" error={errors.category}>
            {kind === 'server' ? (
              <>
                <span className="text-[15px] font-bold">{detail.quote?.water_category.label}</span>
                <span className="text-mute">The category the customer accepted with the price.</span>
              </>
            ) : (
              <div role="radiogroup" aria-label="Water category" className="grid gap-2 sm:grid-cols-2">
                {categories.map((c) => {
                  const ok = c.sources.some((s) => s.reasons.length === 0)
                  return ok ? (
                    <RadioRow key={c.id} checked={categoryId === c.id} onSelect={() => set({ categoryId: c.id, sourceId: null })}>
                      <span className="flex-1">
                        <b className="block">{c.label}</b>
                        <span className="text-caption text-mute">
                          {c.sources.filter((s) => s.reasons.length === 0).length} can be used
                        </span>
                      </span>
                    </RadioRow>
                  ) : (
                    <div key={c.id} aria-disabled="true" className="flex items-center gap-2.5 rounded-icon border-2 border-line bg-canvas px-3 py-2.5 text-mute">
                      <span className="flex-1">
                        <b className="block text-slate">{c.label}</b>
                        <span className="text-caption">No source available</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <Section title="5 Water source" error={errors.source}>
            {requiredKind ? (
              <span className="font-bold text-primary-dark">Customer chose: {SOURCE_KIND_LABEL[requiredKind]}. Only those sources are shown.</span>
            ) : (
              kind === 'manual' &&
              detail.delivery_type === 'tanker' &&
              detail.water_source && <span className="text-mute">Customer's preference: {SOURCE_KIND_LABEL[detail.water_source]}.</span>
            )}
            {category && usable.length === 0 && (
              <Notice>
                <b className="block">No water source can be used for {kind === 'server' ? 'this order' : category.label} right now.</b>
                <span className="mt-2 block">
                  <Button variant="line" size="sm" block={false} onClick={() => options.refetch()}>
                    Check again
                  </Button>
                </span>
              </Notice>
            )}
            {usable.length > 0 && (
              <>
                <span className="font-bold text-green">
                  Can be used for {category?.label} ({usable.length})
                </span>
                <div role="radiogroup" aria-label="Water source" className="flex flex-col gap-2">
                  {usable.map((s) => (
                    <RadioRow key={s.id} checked={form.sourceId === s.id} onSelect={() => set({ sourceId: s.id })}>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <b>{s.name}</b>
                          {s.is_simulated && <Chip tone="gray">Simulated</Chip>}
                        </span>
                        <span className="block text-caption text-mute">{s.approximate_location}</span>
                        {s.report_reference && (
                          <span className="block text-caption text-slate">
                            Lab report {s.report_reference}
                            {s.approved_until && ` · Approved until ${formatCalendarDate(s.approved_until)}`}
                          </span>
                        )}
                      </span>
                    </RadioRow>
                  ))}
                </div>
              </>
            )}
            {unusable.length > 0 && (
              <>
                <span className="font-bold text-mute">
                  Cannot be used for {category?.label} ({unusable.length})
                </span>
                {unusable.map((s) => (
                  <div key={s.id} aria-disabled="true" className="flex flex-col gap-0.5 rounded-icon border-2 border-line bg-canvas px-3 py-2.5 text-mute">
                    <b className="text-slate">{s.name}</b>
                    <span className="text-caption">{s.approximate_location}</span>
                    {s.reasons.map((r) => (
                      <span key={r} className="flex items-center gap-1.5 text-caption text-red">
                        <AlertCircleIcon size={14} /> {C1_REASON_LABEL[r]}
                      </span>
                    ))}
                  </div>
                ))}
              </>
            )}
          </Section>

          <Section title="6 Delivery window" error={errors.window}>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <TextField label="Date" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
              <TextField label="From" type="time" value={form.from} onChange={(e) => set({ from: e.target.value })} />
              <TextField label="To" type="time" value={form.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
            <span className="text-mute">
              Agree the window with the customer before you confirm.
              {detail.preferred_delivery_date && ` Customer's preferred date: ${formatCalendarDate(detail.preferred_delivery_date)}.`} Lagos time.
            </span>
          </Section>

          <Section title="7 Customer agreement" error={errors.agreement}>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1.5 p-0 font-bold">How did the customer agree?</legend>
              {AGREEMENT_METHODS.map((m: AgreementMethod) => (
                <label key={m} className="flex min-h-11 cursor-pointer items-center gap-2">
                  <input type="radio" name="agreement" checked={form.method === m} onChange={() => set({ method: m })} className="size-5" />
                  {AGREEMENT_LABEL[m]}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <TextField label="When (date)" type="date" value={form.agreedDate} onChange={(e) => set({ agreedDate: e.target.value })} />
              <TextField label="When (time)" type="time" value={form.agreedTime} onChange={(e) => set({ agreedTime: e.target.value })} />
            </div>
            <label className={cx('flex cursor-pointer items-start gap-2.5 rounded-option px-3.5 py-3', form.told ? 'bg-sky' : 'bg-canvas')}>
              <input type="checkbox" checked={form.told} onChange={(e) => set({ told: e.target.checked })} className="mt-0.5 size-5 shrink-0" />
              <span>
                I told the customer the total, the water category, the delivery window, that they pay cash after unloading, and that there is no
                cancellation or redelivery charge.
              </span>
            </label>
          </Section>

          <Section title="8 Note" error={errors.note}>
            <TextAreaField
              label="Note"
              optional
              rows={2}
              maxLength={500}
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
              hint={`${form.note.length} / 500`}
            />
          </Section>
        </>
      )}

      <ConfirmDialog
        open={asking}
        title="Confirm this order?"
        confirmLabel="Confirm order"
        tone="primary"
        loading={confirm.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={send}
      >
        <span className="flex flex-col gap-1 rounded-option bg-canvas px-3.5 py-3 text-sub">
          <KeyValue label="Order" value={detail.reference} />
          <KeyValue label="Water category" value={category?.label ?? detail.quote?.water_category.label ?? ''} />
          <KeyValue label="Source" value={source?.name ?? ''} />
          <KeyValue label="Window" value={form.date && form.from && form.to ? formatWindow(`${form.date}T${form.from}:00+01:00`, `${form.date}T${form.to}:00+01:00`) : ''} />
          <KeyValue
            label="Price"
            value={
              <span className="flex items-center justify-end gap-2">
                <PriceChip kind={kind} /> {kobo !== null ? formatNaira(kobo) : ''}
              </span>
            }
          />
          <KeyValue label="Payment" value="Pay on delivery: cash after unloading" />
        </span>
        <span className="mt-2 block">
          {detail.reference} becomes Confirmed and the customer is sent a confirmation SMS.
          {kind === 'manual' && ' The manual price is then fixed for this order.'}
        </span>
      </ConfirmDialog>
    </SideSheet>
  )
}
