import { useId, useState } from 'react'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { INPUT, TextAreaField, TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { ActivationRead, WaterCategoryRead, WaterSourceKind, WaterSourceRead } from '../../../lib/api/adminWaterSources'
import { WATER_SOURCE_KINDS } from '../../../lib/api/adminWaterSources'
import * as api from '../adminApi'
import { useAdminMutation } from '../queries'
import { lagosToday } from '../confirm/logic'
import {
  EMPTY_SOURCE,
  KIND_LABEL,
  LOCATION_MAX,
  NAME_MAX,
  NOT_VERIFIED_LINE,
  REASON_MAX,
  REPORT_MAX,
  TOAST,
  activationDraft,
  activationErrors,
  costTextToKobo,
  reasonError,
  saveFailure,
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

/** The notice under a failed save, with Refresh when the list is out of date. */
function FailureNotice({ error, onRefresh }: { error: unknown; onRefresh: () => void }) {
  const failure = saveFailure(error)
  return (
    <Notice tone="error">
      {failure.message}
      {failure.refresh && (
        <>
          {' '}
          <button type="button" onClick={onRefresh} className="cursor-pointer border-0 bg-transparent p-0 font-bold text-primary underline">
            Refresh
          </button>
        </>
      )}
    </Notice>
  )
}

/**
 * Add a source, or edit one (docs/design/admin-water-sources.md, W2). Adding
 * needs a name and a location; the kind may wait. Editing sends only the
 * fields that differ, and Save changes stays off until something does.
 *
 * @param source - The source being edited, or `null` to add one.
 */
export function SourceDialog({ source, onClose, onDone, onRefresh }: DialogProps & { source: WaterSourceRead | null }) {
  const [draft, setDraft] = useState<SourceDraft>(() =>
    source ? { name: source.name, location: source.approximate_location, kind: source.kind ?? '' } : EMPTY_SOURCE,
  )
  // Errors show once the button was pressed, so a half-typed name is not flagged early.
  const [tried, setTried] = useState(false)
  const kindId = useId()
  const errors = sourceErrors(draft)
  const changes = source ? sourceChanges(source, draft) : null
  const add = useAdminMutation((d: SourceDraft) =>
    api.addWaterSource({ name: d.name.trim(), approximate_location: d.location.trim(), kind: d.kind === '' ? null : d.kind }),
  )
  const edit = useAdminMutation((body: NonNullable<typeof changes>) => api.editWaterSource(source!.id, body))
  const mutation = source ? edit : add

  function send() {
    setTried(true)
    if (errors.name || errors.location) return
    if (source && changes) {
      edit.mutate(changes, { onSuccess: () => onDone(TOAST.updated) })
    } else {
      add.mutate(draft, { onSuccess: () => onDone(TOAST.added) })
    }
  }

  const set = (patch: Partial<SourceDraft>) => setDraft({ ...draft, ...patch })
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
        <TextField label="Name" value={draft.name} maxLength={NAME_MAX} error={tried ? errors.name : undefined} onChange={(e) => set({ name: e.target.value })} />
        <TextField
          label="Location"
          value={draft.location}
          maxLength={LOCATION_MAX}
          hint="Where a driver collects the water, in words."
          error={tried ? errors.location : undefined}
          onChange={(e) => set({ location: e.target.value })}
        />
        <span>
          <label htmlFor={kindId} className="mb-1.5 block text-label font-bold">
            Kind
          </label>
          <select id={kindId} className={INPUT} value={draft.kind} onChange={(e) => set({ kind: e.target.value as WaterSourceKind | '' })}>
            <option value="">Not set yet</option>
            {WATER_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </span>
        {mutation.isError && <FailureNotice error={mutation.error} onRefresh={onRefresh} />}
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
}: DialogProps & { source: WaterSourceRead; category: WaterCategoryRead; current: ActivationRead | null }) {
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
        {save.isError && <FailureNotice error={save.error} onRefresh={onRefresh} />}
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
