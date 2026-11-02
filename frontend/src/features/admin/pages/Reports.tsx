import { useState } from 'react'
import { CheckIcon, CloseIcon, DocumentLinesIcon, TrendUpIcon } from '../../../components/icons/icons'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { DataTable, StatCard } from '../../../components/ui/Admin'
import { Button } from '../../../components/ui/Button'
import { SampleTag } from '../../../components/ui/Chip'
import { Pills } from '../../../components/ui/Controls'
import type { AdminReport, ReportRange } from '../../../domain/admin'
import { formatNaira } from '../../../lib/format/money'
import { AdminFrame, PageHead, Panel } from '../AdminParts'
import { useReport } from '../queries'

const RANGES: { value: ReportRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

/** True when the backend sends what riders earned; the real API does not (partner pay is out of the MVP), so the column is hidden. */
const hasEarnings = (r: AdminReport) => r.by_rider.some((x) => x.earned_minor_units !== undefined)

/** CSV of the report's tables (opened in a spreadsheet; amounts in naira). */
function toCsv(r: AdminReport): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const rows: (string | number)[][] = [
    ['Waterline report', RANGES.find((x) => x.value === r.range)?.label ?? r.range, ...(r.is_sample ? ['SAMPLE DATA'] : [])],
    [],
    ['Orders', r.orders],
    ['Delivered', r.delivered],
    ['Cancelled', r.cancelled],
    [r.is_sample ? 'Revenue (NGN, delivered)' : 'Cash collected (NGN)', r.revenue_minor_units / 100],
    ['Keke orders', r.by_type.keke],
    ['Tanker orders', r.by_type.tanker],
    [],
    ['Area', 'Orders', 'Delivered'],
    ...r.by_area.map((a) => [a.area, a.orders, a.delivered]),
    [],
    ['Rider', 'Code', 'Trips', ...(hasEarnings(r) ? ['Earned (NGN)'] : [])],
    ...r.by_rider.map((x) => [x.name, x.code ?? '', x.trips, ...(hasEarnings(r) ? [(x.earned_minor_units ?? 0) / 100] : [])]),
    [],
    ['Station', 'Loads'],
    ...r.by_station.map((s) => [s.name, s.loads]),
  ]
  return rows.map((row) => row.map(esc).join(',')).join('\r\n')
}

function download(r: AdminReport) {
  const url = URL.createObjectURL(new Blob([toCsv(r)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `mmirioma-report-${r.range}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Reports (added): orders, deliveries and revenue by area, rider and station for a date range. Tagged SAMPLE only when the numbers are simulated. */
export function Reports() {
  const [range, setRange] = useState<ReportRange>('7d')
  const report = useReport(range)
  const r = report.data
  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders">
      <PageHead
        title="Reports"
        sub="Orders and deliveries over time."
        actions={
          <>
            {r?.is_sample && <SampleTag>SAMPLE DATA</SampleTag>}
            <Button size="sm" block={false} variant="alt" disabled={!r} onClick={() => r && download(r)}>
              Download CSV
            </Button>
          </>
        }
      />
      <Pills className="rise-2" label="Date range" value={range} onChange={setRange} options={RANGES} />
      {report.isPending && <LoadingBlock label="Building the report" />}
      {report.isError && <ErrorBlock error={report.error} onRetry={() => report.refetch()} />}
      {r && (
        <>
          <div className="rise-3 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
            <StatCard tone="blue" icon={<DocumentLinesIcon size={24} />} value={r.orders} label="Orders" note={`${r.by_type.keke} Keke · ${r.by_type.tanker} Tanker`} />
            <StatCard tone="green" icon={<CheckIcon size={24} />} value={r.delivered} label="Delivered" note={r.orders ? `${Math.round((r.delivered / r.orders) * 100)}% of orders` : 'No orders'} noteTone="green" />
            <StatCard tone="red" icon={<CloseIcon size={24} />} value={r.cancelled} label="Cancelled" />
            <StatCard tone="green" icon={<TrendUpIcon size={24} strokeWidth={2.2} roundJoin={false} />} value={formatNaira(r.revenue_minor_units)} label="Revenue" note={r.is_sample ? 'SAMPLE prices' : 'Cash collected'} />
          </div>
          <div className="rise-4 grid gap-3.5 xl:grid-cols-3">
            <Panel title="By area">
              <DataTable caption="Orders by area" rows={r.by_area} rowKey={(a) => a.area} empty="No orders." columns={[{ header: 'Area', cell: (a) => a.area }, { header: 'Orders', cell: (a) => a.orders }, { header: 'Delivered', cell: (a) => a.delivered }]} />
            </Panel>
            <Panel title="By rider">
              <DataTable
                caption="Deliveries by rider"
                rows={r.by_rider}
                rowKey={(x) => `${x.name}-${x.code ?? ''}`}
                empty="No deliveries."
                columns={[
                  { header: 'Rider', cell: (x) => (x.code ? `${x.name} · ${x.code}` : x.name) },
                  { header: 'Trips', cell: (x) => x.trips },
                  ...(hasEarnings(r) ? [{ header: 'Earned', cell: (x: AdminReport['by_rider'][number]) => formatNaira(x.earned_minor_units ?? 0) }] : []),
                ]}
              />
            </Panel>
            <Panel title="By station">
              <DataTable caption="Loads by station" rows={r.by_station} rowKey={(s) => s.name} empty="No loads." columns={[{ header: 'Station', cell: (s) => s.name }, { header: 'Orders', cell: (s) => s.loads }]} />
            </Panel>
          </div>
        </>
      )}
    </AdminFrame>
  )
}
