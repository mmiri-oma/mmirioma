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
import { WATER_SOURCES_ARE_SAMPLE } from '../adminApi'
import { AdminFrame, PageHead } from '../AdminParts'
import { adminKeys, useWaterSources } from '../queries'
import { ActivateDialog, SourceDialog, StatusDialog } from '../waterSources/Dialogs'
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, expiryBadge } from '../waterSources/logic'

/** What is open over the page: one dialog at a time. */
type Open =
  | { dialog: 'add' }
  | { dialog: 'edit'; source: WaterSourceRead }
  | { dialog: 'activate'; source: WaterSourceRead; category: WaterCategoryRead; current: ActivationRead | null }
  | { dialog: 'status'; source: WaterSourceRead; category: WaterCategoryRead; status: 'suspended' | 'revoked' }

/**
 * Water sources (docs/design/admin-water-sources.md, #309): where water is
 * collected, and the categories each place is approved for. An admin adds a
 * source, edits its name, location and kind, activates or renews it for a
 * category, and suspends or revokes it. Every change writes the same audit row
 * as the command-line tool, which stays as the fallback.
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
      {open?.dialog === 'activate' && <ActivateDialog source={open.source} category={open.category} current={open.current} onClose={close} onDone={finish} onRefresh={refresh} />}
      {open?.dialog === 'status' && <StatusDialog source={open.source} category={open.category} status={open.status} onClose={close} onDone={finish} onRefresh={refresh} />}
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

/** Columns from 1024 px; below that each category is a stacked block with labelled values. */
const GRID = 'lg:grid-cols-[minmax(120px,1fr)_minmax(110px,.9fr)_minmax(150px,1.2fr)_minmax(120px,1fr)_minmax(90px,.7fr)_auto] lg:items-start lg:gap-3'

function SourceCard({ source, categories, setOpen }: { source: WaterSourceRead; categories: WaterCategoryRead[]; setOpen: (open: Open) => void }) {
  return (
    <Card className="rise-2 flex flex-col p-2">
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[17px] font-extrabold">{source.name}</h2>
            {source.kind ? <Chip tone="blue">{KIND_LABEL[source.kind]}</Chip> : <Chip tone="gray">Kind not set</Chip>}
            {source.is_simulated && <SampleTag>SIMULATED</SampleTag>}
          </div>
          <p className="mt-1 mb-0 text-sub text-mute">{source.approximate_location}</p>
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
        <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-1">
          <Button size="sm" block={false} variant={current ? 'line' : undefined} onClick={() => setOpen({ dialog: 'activate', source, category, current })}>
            {current ? 'Renew' : 'Activate'}
          </Button>
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
        </div>
      </div>
    </div>
  )
}
