import { useId, useState } from 'react'
import { CheckboxRow } from '../../../components/ui/Choice'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Toggle } from '../../../components/ui/Controls'
import { FieldMessages, INPUT, TextAreaField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { ActivationRead, WaterCategoryRead, WaterSourceKind, WaterSourceRead } from '../../../lib/api/adminWaterSources'
import { VEHICLE_KINDS, WATER_SOURCE_KINDS } from '../../../lib/api/adminWaterSources'
import * as api from '../adminApi'
import { useAdminMutation } from '../queries'
import { lagosToday } from '../confirm/logic'
import {
  AVAILABLE_HINT,
  CONTACT_NAME_MAX,
  COST_CHANGE_LINE,
  EMPTY_SOURCE,
  KIND_LABEL,
  LOCATION_MAX,
  NAME_MAX,
  NOT_VERIFIED_LINE,
  REASON_MAX,
  REPORT_MAX,
  TOAST,
  VEHICLE_LABEL,
  activationDraft,
  activationErrors,
  costTextToKobo,
  draftOf,
  koboToCostText,
  reasonError,
  saveFailure,
  serverFieldErrors,
  sourceBody,
  sourceChanges,
  sourceErrors,
  type ActivationDraft,
  type SourceDraft,
} from './logic'

/** What every dialog of the screen is given. */
interface DialogProps {
  onClose: () => void
  /** Tells the page what happened, for its toast. */
  onDone: (message: string) => void
  /** The source changed or was removed meanwhile: reload the list and close. */
  onRefresh: () => void
}

const LINK = 'cursor-pointer border-0 bg-transparent p-0 font-bold text-primary underline'

/**
 * The notice under a failed save, with Refresh when the list is out of date,
 * or Edit source when the server says the source needs a kind first (#407).
 */
function FailureNotice({ error, onRefresh, onEditSource }: { error: unknown; onRefresh: () => void; onEditSource?: () => void }) {
  const failure = saveFailure(error)
  return (
    <Notice tone="error">
      {failure.message}
      {failure.refresh && (
        <>
          {' '}
          <button type="button" onClick={onRefresh} className={LINK}>
            Refresh
          </button>
        </>
      )}
      {failure.editSource && onEditSource && (
        <>
          {' '}
          <button type="button" onClick={onEditSource} className={LINK}>
            Edit source
          </button>
        </>
      )}
    </Notice>
  )
}

/**
 * Add a source, or edit one (docs/design/admin-water-sources.md, W2 and
 * amendment #407). Adding needs a name and a location; the kind and every
 * #407 field may wait. Editing sends only the fields that differ, and Save
 * changes stays off until something does. A server 422 shows under the field
 * it names, with what was typed kept.
 *
 * @param source - The source being edited, or `null` to add one.
 */
export function SourceDialog({ source, onClose, onDone, onRefresh }: DialogProps & { source: WaterSourceRead | null }) {
  const [draft, setDraft] = useState<SourceDraft>(() => (source ? draftOf(source) : EMPTY_SOURCE))
  // Errors show once the button was pressed, so a half-typed name is not flagged early.
  const [tried, setTried] = useState(false)
  const kindId = useId()
  const pickupId = useId()
  const vehiclesId = useId()
  const errors = sourceErrors(draft)
  const changes = source ? sourceChanges(source, draft) : null
  const add = useAdminMutation((d: SourceDraft) => api.addWaterSource(sourceBody(d)))
  const edit = useAdminMutation((body: NonNullable<typeof changes>) => api.editWaterSource(source!.id, body))
  const mutation = source ? edit : add
  const fromServer = serverFieldErrors(mutation.error)
  const shown = { ...(fromServer ?? {}), ...(tried ? errors : {}) }

  function send() {
    setTried(true)
    if (Object.keys(errors).length > 0) return
    if (source && changes) {
      edit.mutate(changes, { onSuccess: () => onDone(TOAST.updated) })
    } else {
      add.mutate(draft, { onSuccess: () => onDone(TOAST.added) })
    }
  }

  // A new value clears the server's answer about the old one.
  const set = (patch: Partial<SourceDraft>) => {
    if (mutation.isError) mutation.reset()
    setDraft({ ...draft, ...patch })
  }
  const toggleVehicle = (kind: (typeof VEHICLE_KINDS)[number], on: boolean) =>
    set({ vehicles: on ? [...draft.vehicles, kind] : draft.vehicles.filter((k) => k !== kind) })
  return (
    <ConfirmDialog
      open
      title={source ? 'Edit this source' : 'Add a source'}
      confirmLabel={source ? 'Save changes' : 'Add source'}
      cancelLabel="Back"
      tone="primary"
      loading={mutation.isPending}
      confirmDisabled={source !== null && changes !== null && Object.keys(changes).length === 0}
      onCancel={onClose}
      onConfirm={send}
    >
      <span className="flex flex-col gap-3">
        <TextField label="Name" value={draft.name} maxLength={NAME_MAX} error={shown.name} onChange={(e) => set({ name: e.target.value })} />
        <TextField
          label="Location"
          value={draft.location}
          maxLength={LOCATION_MAX}
          hint="Where a driver collects the water, in words."
          error={shown.location}
          onChange={(e) => set({ location: e.target.value })}
        />
        <span>
          <label htmlFor={kindId} className="mb-1.5 block text-label font-bold">
            Kind
          </label>
          <select
            id={kindId}
            className={INPUT}
            value={draft.kind}
            aria-describedby={`${kindId}-hint`}
            onChange={(e) => set({ kind: e.target.value as WaterSourceKind | '' })}
          >
            <option value="">Not set yet</option>
            {WATER_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          <FieldMessages id={kindId} hint="A source needs a kind before it can be activated." />
        </span>
        <TextField label="Contact name" optional value={draft.contactName} maxLength={CONTACT_NAME_MAX} onChange={(e) => set({ contactName: e.target.value })} />
        <TextField
          label="Contact phone"
          optional
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={draft.contactPhone}
          error={shown.contactPhone}
          onChange={(e) => set({ contactPhone: e.target.value })}
        />
        <fieldset className="m-0 border-0 p-0" aria-describedby={`${pickupId}-${shown.pickup ? 'error' : 'hint'}`}>
          <legend className="mb-1.5 p-0 text-label font-bold">
            Pickup point <span className="font-normal text-mute">(optional)</span>
          </legend>
          <span className="grid grid-cols-2 gap-2">
            <TextField label="Latitude" inputMode="decimal" value={draft.latitude} onChange={(e) => set({ latitude: e.target.value })} />
            <TextField label="Longitude" inputMode="decimal" value={draft.longitude} onChange={(e) => set({ longitude: e.target.value })} />
          </span>
          <FieldMessages id={pickupId} hint="Copy them from a map pin at the collection point. Used to price by road distance." error={shown.pickup} />
        </fieldset>
        <span className="grid grid-cols-2 gap-2">
          <TextField label="Smallest order (litres)" optional inputMode="numeric" value={draft.minLitres} error={shown.minLitres} onChange={(e) => set({ minLitres: e.target.value })} />
          <TextField label="Largest order (litres)" optional inputMode="numeric" value={draft.maxLitres} error={shown.maxLitres} onChange={(e) => set({ maxLitres: e.target.value })} />
        </span>
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between gap-3">
            <span className="text-label font-bold">Available for new orders</span>
            <Toggle label="Available for new orders" checked={draft.available} onChange={(available) => set({ available })} />
          </span>
          <span className="text-caption text-mute">{AVAILABLE_HINT}</span>
        </span>
        <fieldset className="m-0 border-0 p-0" aria-describedby={shown.vehicles ? `${vehiclesId}-error` : undefined}>
          <legend className="mb-1.5 p-0 text-label font-bold">Vehicles that can load here</legend>
          <span className="grid grid-cols-2 gap-2">
            {VEHICLE_KINDS.map((kind) => (
              <CheckboxRow key={kind} checked={draft.vehicles.includes(kind)} onChange={(e) => toggleVehicle(kind, e.target.checked)}>
                {VEHICLE_LABEL[kind]}
              </CheckboxRow>
            ))}
          </span>
          <FieldMessages id={vehiclesId} error={shown.vehicles} />
        </fieldset>
        {mutation.isError && !fromServer && <FailureNotice error={mutation.error} onRefresh={onRefresh} />}
      </span>
    </ConfirmDialog>
  )
}

/**
 * Activate a source for a category, or renew it (W3). The category is fixed by
 * the row. The report reference is required and the line under the form says
 * the app does not check the report: there is no "report checked" control
 * (decision 2 on #309; FR-012).
 *
 * @param current - The source's activation for this category, or `null` the first time.
 */
export function ActivateDialog({
  source,
  category,
  current,
  onClose,
  onDone,
  onRefresh,
  onEditSource,
}: DialogProps & {
  source: WaterSourceRead
  category: WaterCategoryRead
  current: ActivationRead | null
  /** A 409 `water_source_kind_required` (#407): close this dialog and open Edit. */
  onEditSource: () => void
}) {
  const [draft, setDraft] = useState<ActivationDraft>(() => activationDraft(current))
  const [tried, setTried] = useState(false)
  const errors = activationErrors(draft)
  const renewing = current !== null
  const save = useAdminMutation((d: ActivationDraft) =>
    api.activateWaterSource(source.id, category.id, {
      approved_until: d.until,
      report_reference: d.report.trim(),
      cost_per_litre_minor_units: costTextToKobo(d.cost)!,
    }),
  )

  function send() {
    setTried(true)
    if (errors.report || errors.until || errors.cost) return
    save.mutate(draft, { onSuccess: () => onDone(renewing ? TOAST.renewed(category.label) : TOAST.activated(category.label)) })
  }

  const set = (patch: Partial<ActivationDraft>) => setDraft({ ...draft, ...patch })
  return (
    <ConfirmDialog
      open
      title={`${renewing ? 'Renew' : 'Activate'} for ${category.label}`}
      confirmLabel={renewing ? 'Renew' : 'Activate'}
      cancelLabel="Back"
      tone="primary"
      loading={save.isPending}
      onCancel={onClose}
      onConfirm={send}
    >
      <span className="flex flex-col gap-3">
        <TextField label="Report reference" value={draft.report} maxLength={REPORT_MAX} error={tried ? errors.report : undefined} onChange={(e) => set({ report: e.target.value })} />
        <TextField
          label="Approved until"
          type="date"
          min={lagosToday()}
          value={draft.until}
          error={tried ? errors.until : undefined}
          onChange={(e) => set({ until: e.target.value })}
        />
        <TextField
          label="Cost per litre (₦)"
          inputMode="decimal"
          value={draft.cost}
          placeholder="e.g. 1.50"
          error={tried ? errors.cost : undefined}
          onChange={(e) => set({ cost: e.target.value.replace(/[^\d.,]/g, '') })}
        />
        <span className="text-sub">{NOT_VERIFIED_LINE}</span>
        {save.isError && <FailureNotice error={save.error} onRefresh={onRefresh} onEditSource={onEditSource} />}
      </span>
    </ConfirmDialog>
  )
}

/**
 * Suspend or revoke an activation (W4). A reason is required. Neither deletes
 * anything: a later Renew reinstates the activation.
 */
export function StatusDialog({
  source,
  category,
  status,
  onClose,
  onDone,
  onRefresh,
}: DialogProps & { source: WaterSourceRead; category: WaterCategoryRead; status: 'suspended' | 'revoked' }) {
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const error = reasonError(reason)
  const verb = status === 'suspended' ? 'Suspend' : 'Revoke'
  const save = useAdminMutation((text: string) => api.setWaterSourceStatus(source.id, category.id, { status, reason: text.trim() }))

  function send() {
    setTried(true)
    if (error) return
    save.mutate(reason, { onSuccess: () => onDone(status === 'suspended' ? TOAST.suspended(category.label) : TOAST.revoked(category.label)) })
  }

  return (
    <ConfirmDialog open title={`${verb} for ${category.label}`} confirmLabel={verb} cancelLabel="Back" tone="danger" loading={save.isPending} onCancel={onClose} onConfirm={send}>
      <span className="flex flex-col gap-3">
        <span>From now on this source cannot be chosen for new orders in this category. Orders already confirmed with it keep it.</span>
        <TextAreaField label="Reason" rows={2} maxLength={REASON_MAX} value={reason} error={tried ? error : undefined} onChange={(e) => setReason(e.target.value)} />
        {save.isError && <FailureNotice error={save.error} onRefresh={onRefresh} />}
      </span>
    </ConfirmDialog>
  )
}

/**
 * Change only the cost per litre of an activation, in any status (design
 * amendment #407). The status, report reference and date stay as they are. The
 * line under the field says the cost is read by new quotes only (FR-024, T-09).
 */
export function CostDialog({
  source,
  category,
  current,
  onClose,
  onDone,
  onRefresh,
}: DialogProps & { source: WaterSourceRead; category: WaterCategoryRead; current: ActivationRead }) {
  const [cost, setCost] = useState(() => koboToCostText(current.cost_per_litre_minor_units))
  const [tried, setTried] = useState(false)
  const kobo = costTextToKobo(cost)
  const error = kobo === null ? 'Enter the cost as naira, for example 1.50.' : undefined
  const save = useAdminMutation((value: number) => api.changeWaterSourceCost(source.id, category.id, { cost_per_litre_minor_units: value }))

  function send() {
    setTried(true)
    if (kobo === null) return
    save.mutate(kobo, { onSuccess: () => onDone(TOAST.costChanged(category.label)) })
  }

  return (
    <ConfirmDialog
      open
      title={`Change cost for ${category.label}`}
      confirmLabel="Save cost"
      cancelLabel="Back"
      tone="primary"
      loading={save.isPending}
      confirmDisabled={kobo === current.cost_per_litre_minor_units}
      onCancel={onClose}
      onConfirm={send}
    >
      <span className="flex flex-col gap-3">
        <TextField
          label="Cost per litre (₦)"
          inputMode="decimal"
          value={cost}
          hint={COST_CHANGE_LINE}
          error={tried ? error : undefined}
          onChange={(e) => setCost(e.target.value.replace(/[^\d.,]/g, ''))}
        />
        {save.isError && <FailureNotice error={save.error} onRefresh={onRefresh} />}
      </span>
    </ConfirmDialog>
  )
}
