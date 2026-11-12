import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip, SampleTag } from '../../../components/ui/Chip'
import { Notice } from '../../../components/ui/Notice'
import { LoadingBlock } from '../../../components/layout/StateScreens'
import { AlertCircleIcon } from '../../../components/icons/icons'
import { ApiError } from '../../../lib/api/client'
import type { ActivationRead, WaterCategoryRead, WaterSourceRead } from '../../../lib/api/adminWaterSources'
import { formatCalendarDate } from '../../../lib/format/datetime'
import { formatNaira } from '../../../lib/format/money'
import * as api from '../adminApi'
import { WATER_SOURCES_ARE_SAMPLE } from '../adminApi'
import { AdminFrame, PageHead } from '../AdminParts'
import { adminKeys, useWaterSources } from '../queries'
import { ActivateDialog, CostDialog, SourceDialog, StatusDialog } from '../waterSources/Dialogs'
import {
  KIND_LABEL,
  SET_KIND_FIRST,
  STATUS_LABEL,
  STATUS_TONE,
  contactLine,
  expiryBadge,
  kindNotice,
  orderSizeLine,
  pickupLine,
  vehiclesLine,
} from '../waterSources/logic'

/** What is open over the page: one dialog at a time. */
type Open =
  | { dialog: 'add' }
  | { dialog: 'edit'; source: WaterSourceRead }
  | { dialog: 'activate'; source: WaterSourceRead; category: WaterCategoryRead; current: ActivationRead | null }
  | { dialog: 'status'; source: WaterSourceRead; category: WaterCategoryRead; status: 'suspended' | 'revoked' }
  | { dialog: 'cost'; source: WaterSourceRead; category: WaterCategoryRead; current: ActivationRead }

/**
 * Water sources (docs/design/admin-water-sources.md, #309, amendment #407):
 * where water is collected, and the categories each place is approved for. An
 * admin adds a source, edits its name, location, kind, supplier contact,
 * pickup point, order sizes, availability and vehicles, activates or renews it
 * for a category, changes its cost, and suspends or revokes it. A source with
 * no kind cannot be activated, and a notice counts those sources. Every change
 * writes an audit row naming the changed fields, never their values.
 *
 * The app records the report reference and does not check the laboratory
 * report (FR-012), so nothing here reads as the approval itself, and nothing
 * says anything about the water.
 */
export function WaterSources() {
  const sources = useWaterSources()
  const qc = useQueryClient()
  const [open, setOpen] = useState<Open | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const close = () => setOpen(null)
  const finish = (message: string) => {
    setOpen(null)
    setDone(message)
  }
  const refresh = () => {
    setOpen(null)
    setDone(null)
    void qc.invalidateQueries({ queryKey: adminKeys.waterSources })
  }
  /**
   * After a 409 `water_source_kind_required` the page's copy of the source is
   * out of date (another admin cleared the kind, or it was never set), so Edit
   * opens from a fresh read: from the stale copy it would show the old kind
   * and keep Save off. If the read fails or the source is gone, the list
   * reloads instead.
   */
  const editFresh = async (sourceId: string) => {
    try {
      const fresh = await qc.fetchQuery({ queryKey: adminKeys.waterSources, queryFn: api.listWaterSources, staleTime: 0 })
      const source = fresh.items.find((s) => s.id === sourceId)
      if (source) setOpen({ dialog: 'edit', source })
      else refresh()
    } catch {
      refresh()
    }
  }

  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders">
      <PageHead
        title="Water sources"
        sub="Where water is collected, and the categories each place is approved for."
        actions={
          <>
            {WATER_SOURCES_ARE_SAMPLE && <SampleTag>SAMPLE DATA</SampleTag>}
            <Button size="sm" block={false} onClick={() => setOpen({ dialog: 'add' })}>
              Add a source
            </Button>
          </>
        }
      />
      {done && <Notice tone="success">{done}</Notice>}
      {sources.data && kindNotice(sources.data.items) && <Notice tone="note">{kindNotice(sources.data.items)}</Notice>}
      {sources.isPending && <LoadingBlock label="Loading water sources" />}
      {sources.isError && <LoadFailure error={sources.error} onRetry={() => sources.refetch()} />}
      {sources.data && sources.data.items.length === 0 && (
        <Card pad className="rise-2 flex flex-col gap-1">
          <p className="m-0 font-bold">No water sources yet.</p>
          <p className="m-0 text-sub text-mute">Add the first one, then activate it for a category. An order cannot be confirmed from a source that is not activated.</p>
        </Card>
      )}
      {sources.data?.items.map((source) => (
        <SourceCard key={source.id} source={source} categories={sources.data.categories} setOpen={setOpen} />
      ))}
      {open?.dialog === 'add' && <SourceDialog source={null} onClose={close} onDone={finish} onRefresh={refresh} />}
      {open?.dialog === 'edit' && <SourceDialog source={open.source} onClose={close} onDone={finish} onRefresh={refresh} />}
      {open?.dialog === 'activate' && (
        <ActivateDialog
          source={open.source}
          category={open.category}
          current={open.current}
          onClose={close}
          onDone={finish}
          onRefresh={refresh}
          onEditSource={() => void editFresh(open.source.id)}
        />
      )}
      {open?.dialog === 'status' && <StatusDialog source={open.source} category={open.category} status={open.status} onClose={close} onDone={finish} onRefresh={refresh} />}
      {open?.dialog === 'cost' && <CostDialog source={open.source} category={open.category} current={open.current} onClose={close} onDone={finish} onRefresh={refresh} />}
    </AdminFrame>
  )
}

/** The page could not load: a plain sentence and Try again, or the shared 403 wording. */
function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403
  return (
    <Card pad role="alert" className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 text-red">
        <AlertCircleIcon size={20} />
        <p className="m-0 font-bold">{forbidden ? "You can't open this page." : "We couldn't load the water sources."}</p>
      </div>
      {!forbidden && (
        <Button variant="alt" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  )
}

/**
 * Columns from 1024 px; below that each category is a stacked block with labelled values.
 * Every track is a fixed minimum plus `fr`, never `auto`: the header and each row are
 * separate grids, so a track sized to its content (the row's buttons) would give each row
 * its own column widths and misalign them (#421).
 */
const GRID = 'lg:grid-cols-[minmax(120px,1fr)_minmax(110px,.9fr)_minmax(150px,1.2fr)_minmax(120px,1fr)_minmax(90px,.7fr)_minmax(150px,1.4fr)] lg:items-start lg:gap-3'

function SourceCard({ source, categories, setOpen }: { source: WaterSourceRead; categories: WaterCategoryRead[]; setOpen: (open: Open) => void }) {
  return (
    <Card className="rise-2 flex flex-col p-2">
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[17px] font-extrabold">{source.name}</h2>
            {source.kind ? <Chip tone="blue">{KIND_LABEL[source.kind]}</Chip> : <Chip tone="amber">Kind not set</Chip>}
            {!source.is_available && <Chip tone="gray">Unavailable</Chip>}
            {source.is_simulated && <SampleTag>SIMULATED</SampleTag>}
          </div>
          <p className="mt-1 mb-0 text-sub text-mute">{source.approximate_location}</p>
          <SourceFacts source={source} />
        </div>
        <Button variant="line" size="sm" block={false} onClick={() => setOpen({ dialog: 'edit', source })}>
          Edit
        </Button>
      </div>
      <div role="row" className={`${GRID} hidden border-0 border-y border-solid border-line px-3 py-2.5 text-chip font-bold text-mute lg:grid`}>
        {['Category', 'Status', 'Approved until', 'Report reference', 'Cost per litre', ''].map((h) => (
          <span key={h} role="columnheader">
            {h}
          </span>
        ))}
      </div>
      {categories.map((category) => (
        <CategoryRow key={category.id} source={source} category={category} current={source.activations.find((a) => a.category.id === category.id) ?? null} setOpen={setOpen} />
      ))}
    </Card>
  )
}

/** One line of facts under the name (design amendment #407). Coordinates are never shown on the card. */
function SourceFacts({ source }: { source: WaterSourceRead }) {
  const pickup = pickupLine(source)
  const facts: { label: string; text: string; muted?: boolean }[] = [
    { label: 'Contact', text: contactLine(source) },
    { label: 'Pickup point', text: pickup.text, muted: !pickup.set },
    { label: 'Order size', text: orderSizeLine(source) },
    { label: 'Vehicles', text: vehiclesLine(source.vehicle_kinds) },
  ]
  return (
    <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
      {facts.map((fact) => (
        <li key={fact.label} className={fact.muted ? 'text-mute' : undefined}>
          <span className="sr-only">{fact.label}: </span>
          {fact.text}
        </li>
      ))}
    </ul>
  )
}

/** A labelled value: the label shows only when the columns are stacked. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-chip font-bold text-mute lg:sr-only">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function CategoryRow({
  source,
  category,
  current,
  setOpen,
}: {
  source: WaterSourceRead
  category: WaterCategoryRead
  current: ActivationRead | null
  setOpen: (open: Open) => void
}) {
  const badge = current ? expiryBadge(current) : null
  // Decision 407-2: no activation without a kind. The server refuses it too (409).
  const noKind = source.kind === null
  return (
    <div className="border-0 border-t border-solid border-row-line px-3 py-3 first:border-t-0">
      <div className={`${GRID} grid grid-cols-2 gap-3`}>
        <Cell label="Category">
          <b>{category.label}</b>
        </Cell>
        <Cell label="Status">
          {current ? <Chip tone={STATUS_TONE[current.status]}>{STATUS_LABEL[current.status]}</Chip> : <Chip tone="gray">Not activated</Chip>}
          {current?.status_reason && <p className="mt-1 mb-0 text-caption text-mute">{current.status_reason}</p>}
        </Cell>
        <Cell label="Approved until">
          {current ? (
            <span className="flex flex-wrap items-center gap-2">
              {formatCalendarDate(current.approved_until)}
              {badge && <Chip tone={badge.tone}>{badge.text}</Chip>}
            </span>
          ) : (
            <span className="text-mute">None</span>
          )}
        </Cell>
        <Cell label="Report reference">{current ? current.report_reference : <span className="text-mute">None</span>}</Cell>
        <Cell label="Cost per litre">{current ? formatNaira(current.cost_per_litre_minor_units) : <span className="text-mute">None</span>}</Cell>
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1">
          <Button
            size="sm"
            block={false}
            variant={current ? 'line' : undefined}
            disabled={noKind}
            aria-describedby={noKind ? `set-kind-${source.id}-${category.id}` : undefined}
            onClick={() => setOpen({ dialog: 'activate', source, category, current })}
          >
            {current ? 'Renew' : 'Activate'}
          </Button>
          {current && (
            <Button variant="line" size="sm" block={false} onClick={() => setOpen({ dialog: 'cost', source, category, current })}>
              Change cost
            </Button>
          )}
          {current && current.status !== 'suspended' && (
            <Button variant="line-danger" size="sm" block={false} onClick={() => setOpen({ dialog: 'status', source, category, status: 'suspended' })}>
              Suspend
            </Button>
          )}
          {current && current.status !== 'revoked' && (
            <Button variant="line-danger" size="sm" block={false} onClick={() => setOpen({ dialog: 'status', source, category, status: 'revoked' })}>
              Revoke
            </Button>
          )}
          {noKind && (
            <span id={`set-kind-${source.id}-${category.id}`} className="w-full text-caption text-mute">
              {SET_KIND_FIRST}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
