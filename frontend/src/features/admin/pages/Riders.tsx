import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { DataTable } from '../../../components/ui/Admin'
import { Avatar } from '../../../components/ui/Avatar'
import { Button, ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { OptionTile } from '../../../components/ui/Choice'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { KeyValue } from '../../../components/ui/Content'
import { Pills } from '../../../components/ui/Controls'
import { TextAreaField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { AdminRider, ApprovalVehicleInput } from '../../../domain/admin'
import type { DeliveryType } from '../../../domain/orders'
import { describeQuantity, litresFromGallons } from '../../../domain/quantity'
import { parseGallons } from '../../../domain/tankCapacity'
import { cx } from '../../../lib/cx'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { USE_MOCKS } from '../../../lib/api/mode'
import { DIRECTORY_EDITS_ENABLED } from '../../../lib/features'
import { formatNaira } from '../../../lib/format/money'
import { formatPhone } from '../../../lib/format/phone'
import * as api from '../adminApi'
import { revealDetail } from '../adminFormat'
import { AdminFrame, ApprovalChip, OnlineChip, PageHead, SplitLayout } from '../AdminParts'
import { REASON_HINT } from '../auditWording'
import { useAdminMutation, useRider, useRiders } from '../queries'

const FILTERS: { value: api.RiderFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'keke', label: 'Keke' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'pending', label: 'Pending approval' },
  { value: 'suspended', label: 'Suspended' },
]

/** Riders and drivers (`a-riders`): approve, suspend and reactivate. `?id=` selects one. */
export function Riders() {
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<api.RiderFilter>('all')
  const query = params.get('q') ?? ''
  const list = useRiders(filter, query)
  const rows = list.data?.riders ?? []
  const selected = params.get('id') ?? rows[0]?.id ?? null

  return (
    <AdminFrame searchPlaceholder="Search riders by name, phone or plate" onSearch={(q) => setParams(q ? { q } : {}, { replace: true })}>
      <SplitLayout
        sideWidth="lg:w-[360px]"
        main={
          <>
            <PageHead
              title="Riders and drivers"
              sub={list.data ? `${list.data.counts.all ?? list.data.riders.length} riders · ${list.data.online} online now · ${list.data.pending} waiting for approval` : 'Approve, suspend and reactivate partners.'}
              actions={
                DIRECTORY_EDITS_ENABLED && (
                  <ButtonLink to="/admin/riders/new" size="sm" block={false}>
                    + Add rider
                  </ButtonLink>
                )
              }
            />
            <Pills
              className="rise-2"
              label="Filter riders"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f.value, label: f.value === 'all' && list.data && list.data.counts.all !== null ? `All (${list.data.counts.all})` : f.label }))}
            />
            {list.isPending && <LoadingBlock label="Loading riders" />}
            {list.isError && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
            {list.isSuccess && (
              <Card className="rise-3 overflow-x-auto px-1 py-1.5">
                <DataTable<AdminRider>
                  caption="Riders and drivers"
                  rows={rows}
                  rowKey={(r) => r.id}
                  selectedKey={selected ?? undefined}
                  empty="No riders here."
                  columns={[
                    {
                      header: 'Rider',
                      cell: (r) => (
                        <button type="button" onClick={() => {
                            setParams(query ? { q: query, id: r.id } : { id: r.id }, { replace: true })
                            revealDetail()
                          }} className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-ink">
                          <Avatar name={r.name} size={36} />
                          <span>
                            <span className="block font-extrabold">{r.name}</span>
                            {r.code && <span className="block text-chip text-mute">{r.code}</span>}
                          </span>
                        </button>
                      ),
                    },
                    { header: 'Vehicle', cell: (r) => vehicleLine(r.vehicle) },
                    { header: 'Area', cell: (r) => r.service_areas.join(', ') },
                    { header: 'Status', cell: (r) => <OnlineChip online={r.online} /> },
                    { header: 'Approval', cell: (r) => <ApprovalChip status={r.approval} /> },
                    ...(USE_MOCKS ? [{ header: 'Today', cell: (r: AdminRider) => formatNaira(r.today_minor_units ?? 0) }] : []),
                  ]}
                />
              </Card>
            )}
            {USE_MOCKS && <p className="m-0 text-caption text-mute">Pay amounts are SAMPLE (decision 16).</p>}
          </>
        }
        side={selected ? <RiderPanel key={selected} id={selected} /> : null}
      />
    </AdminFrame>
  )
}

/** A suspension needs a reason of at least this many characters, after trimming (admin-directory.md, `ApprovalChange.reason`). */
const MIN_SUSPEND_REASON = 5
const REASON_REQUIRED = 'A reason of at least 5 characters is required'

function RiderPanel({ id }: { id: string }) {
  const rider = useRider(id)
  const [reason, setReason] = useState('')
  // Set when "Suspend rider" is pressed with a reason that is too short; shown under the box, without opening the sheet (#294).
  const [reasonMissing, setReasonMissing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [vehicle, setVehicle] = useState<VehicleForm>({ description: '', payload: '', ground: false, overhead: false })
  const change = useAdminMutation((action: api.ApprovalAction) =>
    api.setRiderApproval(id, action, reason, action !== 'suspend' && !USE_MOCKS && rider.data?.vehicle_verified === false ? vehicleInput(vehicle) : undefined),
  )
  const r = rider.data
  if (rider.isPending) return <Card className="p-4"><LoadingBlock label="Loading the rider" /></Card>
  if (rider.isError || !r) return <Card className="p-4"><ErrorBlock error={rider.error} onRetry={() => rider.refetch()} /></Card>
  const action: api.ApprovalAction = r.approval === 'pending' ? 'approve' : r.approval === 'approved' ? 'suspend' : 'reactivate'
  /** Check a suspension's reason before asking to confirm, so the sheet never asks about an action that cannot go through. */
  const ask = (next: api.ApprovalAction) => {
    if (next === 'suspend' && reason.trim().length < MIN_SUSPEND_REASON) {
      setReasonMissing(true)
      return
    }
    setAsking(true)
  }
  return (
    <Card className="rise-2 flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={r.name} size={60} fontSize={20} />
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-extrabold">{r.name}</div>
          <div className="text-mute">{formatPhone(r.phone)}</div>
        </div>
        <ApprovalChip status={r.approval} />
      </div>
      <div className="flex flex-col items-center gap-1 rounded-card bg-[linear-gradient(160deg,#EEF6FF,#DCEBFD)] py-3">
        <Illustration name={r.vehicle.type ?? 'drop-hero'} className="w-40" />
        <div className="font-extrabold">
          {vehicleLine(r.vehicle)}
          {r.vehicle.tank_gallons && ` · ${describeQuantity(litresFromGallons(r.vehicle.tank_gallons), 'gallons', 'short')}`}
        </div>
      </div>
      {/* The backend has no rating, pay, documents note or issue count (partner pay is out of the MVP): absent in real mode, so hidden. */}
      <div className={cx('grid gap-2 text-center', USE_MOCKS ? 'grid-cols-3' : 'grid-cols-1')}>
        <Mini value={r.trips} label="Trips" />
        {USE_MOCKS && <Mini value={r.rating ?? 'New'} label="Rating" />}
        {r.payout_due_minor_units !== undefined && <Mini value={formatNaira(r.payout_due_minor_units)} label="Payout due" />}
      </div>
      <div className="text-[14px]">
        {r.documents_note !== undefined && <KeyValue label="Documents" value={r.documents_note} />}
        <KeyValue label="Active orders" value={r.active_orders} />
        {r.reported_issues !== undefined && <KeyValue label="Reported issues" value={r.reported_issues} />}
        <KeyValue label="Works in" value={r.service_areas.join(', ') || 'Not set'} />
      </div>
      {action !== 'suspend' && !USE_MOCKS && r.vehicle_verified === false && <VehicleFields rider={r} form={vehicle} onChange={setVehicle} errors={fieldErrors(change.error)} />}
      {action !== 'approve' && (
        <TextAreaField
          label={`Reason to ${action} (saved in the audit log)`}
          hint={REASON_HINT}
          rows={2}
          value={reason}
          error={fieldErrors(change.error).reason ?? (reasonMissing ? REASON_REQUIRED : undefined)}
          onChange={(e) => {
            setReason(e.target.value)
            setReasonMissing(false)
          }}
          placeholder={action === 'suspend' ? 'e.g. Papers expired; two missed deliveries' : 'e.g. New papers checked'}
        />
      )}
      {change.isError && !fieldErrors(change.error).reason && !fieldErrors(change.error).description && !fieldErrors(change.error).payload && !fieldErrors(change.error).methods && (
        <Notice tone="error">{fieldErrors(change.error).other ?? errorMessage(change.error)}</Notice>
      )}
      {change.isSuccess && <Notice tone="success">Saved. The rider sees the change in their app.</Notice>}
      <Button variant={action === 'suspend' ? 'line-danger' : 'primary'} loading={change.isPending} onClick={() => ask(action)}>
        {action === 'approve' ? 'Approve rider' : action === 'suspend' ? 'Suspend rider' : 'Reactivate rider'}
      </Button>
      <ConfirmDialog
        open={asking}
        tone={action === 'suspend' ? 'danger' : 'primary'}
        title={action === 'approve' ? `Approve ${r.name}?` : action === 'suspend' ? `Suspend ${r.name}?` : `Reactivate ${r.name}?`}
        confirmLabel={action === 'approve' ? 'Approve' : action === 'suspend' ? 'Suspend' : 'Reactivate'}
        loading={change.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() =>
          change.mutate(action, {
            // The reason belongs to the action just done: the next one (suspend, then reactivate) starts with an empty box.
            onSuccess: () => {
              setReason('')
              setReasonMissing(false)
            },
            onSettled: () => setAsking(false),
          })
        }
      >
        {action === 'approve'
          ? 'They can go online and accept orders straight away.'
          : action === 'suspend'
            ? 'They go offline and get no new orders. Orders assigned but not started go back to the pool.'
            : 'They can go online and accept orders again.'}
      </ConfirmDialog>
      <p className="m-0 text-caption text-mute">
        {action === 'approve'
          ? 'Check the licence and vehicle papers first. Approved riders can go online and accept orders.'
          : action === 'suspend'
            ? 'Suspended riders go offline and get no new orders; orders assigned but not started go back to the pool. Every change is saved in the audit log.'
            : 'Reactivated riders can go online again. Every change is saved in the audit log.'}
      </p>
    </Card>
  )
}

/** "Keke · ENU 482 KK": the type and plate the partner declared, with nothing invented when the backend has none. */
function vehicleLine(vehicle: AdminRider['vehicle']): string {
  const type = vehicle.type === 'keke' ? 'Keke' : vehicle.type === 'tanker' ? 'Tanker' : null
  return [type, vehicle.plate || null].filter(Boolean).join(' · ') || 'Not recorded'
}

/** What the admin typed in the approve form. */
interface VehicleForm {
  description: string
  payload: string
  ground: boolean
  overhead: boolean
}

/** The vehicle to send with an approval (FR-013); the server checks every field and answers 422 under the one it refuses. */
function vehicleInput(form: VehicleForm): ApprovalVehicleInput {
  const litres = Number(form.payload.replace(/[^\d]/g, ''))
  return {
    description: form.description.trim(),
    safe_payload_litres: Number.isFinite(litres) ? litres : 0,
    transfer_methods: [form.ground && 'ground', form.overhead && 'overhead'].filter((m): m is 'ground' | 'overhead' => Boolean(m)),
  }
}

interface FieldErrors {
  description?: string
  payload?: string
  methods?: string
  reason?: string
  /** A refusal that names no field, in the server's words. */
  other?: string
}

/**
 * The server's words for each field it refused (422), keyed by the form field, for display under it.
 *
 * The reason rule is a check on the whole body, so the server reports it at `["body"]` and not at `reason`: a
 * body-level message about the reason belongs under the reason field. pydantic's "Value error, " prefix is dropped.
 */
function fieldErrors(error: unknown): FieldErrors {
  const out: FieldErrors = {}
  if (!(error instanceof ApiError) || error.code !== 'validation_error' || !Array.isArray(error.details)) return out
  for (const item of error.details as { loc?: unknown; msg?: unknown }[]) {
    if (typeof item.msg !== 'string') continue
    const msg = item.msg.replace(/^Value error, /, '')
    const last = Array.isArray(item.loc) ? item.loc.at(-1) : null
    const key =
      last === 'description' ? 'description' : last === 'safe_payload_litres' ? 'payload' : last === 'transfer_methods' ? 'methods' : last === 'reason' || /\breason\b/i.test(msg) ? 'reason' : 'other'
    if (!out[key]) out[key] = msg
  }
  return out
}

/**
 * The example text in the vehicle form, by the rider's declared vehicle type (#294). A Keke has no standard
 * capacity in the SRS or `partners.md`, so its payload box shows no example number; an unknown type keeps the
 * tanker examples.
 */
function vehicleExamples(type: AdminRider['vehicle']['type']): { vehicle: string; payload: string } {
  return type === 'keke' ? { vehicle: 'e.g. Keke', payload: 'Litres you measured' } : { vehicle: 'e.g. Tanker truck', payload: 'e.g. 12000' }
}

/**
 * The vehicle an admin verifies when approving a partner who has none yet (FR-013): its description, the safe
 * payload per trip and the transfer methods. What the partner declared at sign-up is shown as a claim only.
 */
function VehicleFields({
  rider,
  form,
  onChange,
  errors,
}: {
  rider: AdminRider
  form: VehicleForm
  onChange: (form: VehicleForm) => void
  errors: FieldErrors
}) {
  const declared = rider.declared_vehicle
  const examples = vehicleExamples(rider.vehicle.type)
  const claim = [declared?.plate, declared?.capacity_litres ? `${describeQuantity(declared.capacity_litres, 'gallons', 'short')}` : null].filter(Boolean).join(' · ')
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 rounded-card bg-[#F4F7FB] p-3.5">
      <legend className="p-0 text-[14px] font-extrabold">Vehicle you checked</legend>
      {claim && <p className="m-0 text-caption text-mute">Declared by the partner, not checked: {claim}.</p>}
      <TextField label="Vehicle" value={form.description} error={errors.description} onChange={(e) => onChange({ ...form, description: e.target.value })} placeholder={examples.vehicle} />
      <TextField
        label="Safe payload per trip (litres)"
        inputMode="numeric"
        value={form.payload}
        error={errors.payload}
        onChange={(e) => onChange({ ...form, payload: e.target.value.replace(/[^\d]/g, '') })}
        placeholder={examples.payload}
      />
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-bold">Transfer method</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.ground} onChange={(e) => onChange({ ...form, ground: e.target.checked })} className="size-5" />
          Ground
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={form.overhead} onChange={(e) => onChange({ ...form, overhead: e.target.checked })} className="size-5" />
          Overhead
        </label>
        {errors.methods && <span className="text-caption font-bold text-red">{errors.methods}</span>}
      </div>
    </fieldset>
  )
}

function Mini({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-input bg-[#F4F7FB] px-2 py-2.5">
      <div className="text-[17px] font-extrabold">{value}</div>
      <div className="text-chip text-mute">{label}</div>
    </div>
  )
}

/** Add a rider or driver from the office (`/admin/riders/new`). Built from the partner sign-up; the account starts pending. */
export function NewRider() {
  const navigate = useNavigate()
  const [vehicle, setVehicle] = useState<DeliveryType>('keke')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [plate, setPlate] = useState('')
  const [area, setArea] = useState('')
  const [gallons, setGallons] = useState('')
  const add = useAdminMutation(() =>
    api.addRider({ name, phone, vehicle_type: vehicle, plate, service_area: area, tank_gallons: vehicle === 'tanker' ? parseGallons(gallons) : null }),
  )
  const err = (field: string) =>
    add.error instanceof ApiError && Array.isArray(add.error.details) ? (add.error.details as { loc: string[]; msg: string }[]).find((d) => d.loc.includes(field))?.msg : undefined
  const fieldLevel = add.error instanceof ApiError && add.error.code === 'validation_error'

  return (
    <AdminFrame searchPlaceholder="Search riders by name, phone or plate" onSearch={(q) => navigate(q ? `/admin/riders?q=${encodeURIComponent(q)}` : '/admin/riders')}>
      <PageHead title="Add a rider or driver" sub="They start waiting for approval; check their papers, then approve them on the Riders page." />
      <Card className="rise-2 flex max-w-[720px] flex-col gap-4 p-5">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate(undefined, { onSuccess: (r) => navigate(`/admin/riders?id=${r.id}`, { replace: true }) })
          }}
        >
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[14px] font-bold">Vehicle</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['keke', 'tanker'] as const).map((t) => (
                <OptionTile key={t} selected={vehicle === t} onSelect={() => setVehicle(t)} className="pt-4 pb-3">
                  <Illustration name={t} className="h-14 w-auto" />
                  <span className="text-[15px] font-extrabold">{t === 'keke' ? 'Keke' : 'Tanker'}</span>
                </OptionTile>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ifeanyi James" error={err('name')} />
            <TextField label="Phone number" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" error={err('phone')} />
            <TextField label="Plate number" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder={vehicle === 'keke' ? 'ENU 482 KK' : 'ENU 115 XA'} error={err('plate')} />
            <TextField label="Area they work in" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. GRA" error={err('service_area')} />
            {vehicle === 'tanker' && (
              <TextField
                label="How many gallons does the tanker carry?"
                inputMode="numeric"
                value={gallons}
                onChange={(e) => setGallons(e.target.value)}
                placeholder="e.g. 4,000"
                hint={
                  parseGallons(gallons) !== null
                    ? `That is ${litresFromGallons(parseGallons(gallons) ?? 0).toLocaleString('en-NG')} litres.`
                    : 'For example 4,000 gallons (16,000 litres).'
                }
                error={err('tank_gallons')}
              />
            )}
          </div>
          {add.isError && !fieldLevel && <Notice tone="error">{errorMessage(add.error)}</Notice>}
          <p className="m-0 text-caption text-mute">They sign in at the partner app with this phone number and set a password with “Forgot password”.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" block={false} className="px-5" loading={add.isPending}>
              Add rider
            </Button>
            <ButtonLink to="/admin/riders" variant="line" size="sm" block={false} className="px-5">
              Cancel
            </ButtonLink>
          </div>
        </form>
      </Card>
    </AdminFrame>
  )
}
