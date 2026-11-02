import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CreditCardIcon,
  DocumentLinesIcon,
  NavigationIcon,
  PlusIcon,
  StationDoorIcon,
  TrendUpIcon,
  VehicleIcon,
  WalletOutlineIcon,
} from '../../../components/icons/icons'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { DataTable, MiniLink, StatCard } from '../../../components/ui/Admin'
import { ButtonLink } from '../../../components/ui/Button'
import { Chip, SampleTag } from '../../../components/ui/Chip'
import { IconBadge, type IconBadgeTone } from '../../../components/ui/Content'
import type { ActivityKind, AdminOrder } from '../../../domain/admin'
import { USE_MOCKS } from '../../../lib/api/mode'
import { ORDER_FOR_CUSTOMER_ENABLED, STATIONS_PAGE_ENABLED } from '../../../lib/features'
import { formatDayDate } from '../../../lib/format/datetime'
import { formatNaira } from '../../../lib/format/money'
import { greeting } from '../../partner/greeting'
import { timeAgo } from '../adminFormat'
import { AdminMap, MapLegend } from '../AdminMap'
import { AdminFrame, Panel, StatusChip } from '../AdminParts'
import { useActivity, useAdminOrders, useDashboard, useLiveMap, useShellData, useStations } from '../queries'

const ACTIVITY: Record<ActivityKind, { tone: IconBadgeTone; icon: ReactNode }> = {
  accepted: { tone: 'blue', icon: <CheckIcon size={16} /> },
  new_order: { tone: 'teal', icon: <PlusIcon size={16} /> },
  online: { tone: 'violet', icon: <span className="text-[13px] font-extrabold">o</span> },
  delivered: { tone: 'green', icon: <CheckIcon size={16} /> },
  complaint: { tone: 'red', icon: <span className="text-[13px] font-extrabold">!</span> },
  admin: { tone: 'gold', icon: <span className="text-[13px] font-extrabold">·</span> },
}

/** Admin dashboard (`a-dashboard`). Numbers are worked out from the (sample) records; money is SAMPLE. */
export function Dashboard() {
  const navigate = useNavigate()
  const shell = useShellData()
  const dash = useDashboard()
  const map = useLiveMap()
  const activity = useActivity(5)
  const recent = useAdminOrders('all', '')
  // Mock mode lists the sample stations; the real API has no stations endpoint, so the panel reads the live map's water sources (#217).
  const stations = useStations('', USE_MOCKS)
  const d = dash.data
  const first = shell.data?.user.name.split(' ')[0] ?? ''

  const total = d ? d.orders.total : 0
  const segs = d
    ? [
        { label: 'Delivered', value: d.orders.delivered, color: '#22C55E' },
        { label: 'In progress', value: d.orders.in_progress, color: '#1570D8' },
        { label: 'Awaiting rider', value: d.orders.awaiting_rider, color: '#F59E0B' },
        { label: 'Cancelled', value: d.orders.cancelled, color: '#EF4444' },
      ]
    : []

  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders, stations" onSearch={(q) => q && navigate(`/admin/orders?q=${encodeURIComponent(q)}`)}>
      <div className="rise-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-admin-title leading-[1.2] font-extrabold tracking-[-0.4px]">
            {greeting()}
            {first && `, ${first}`}
          </h1>
          <p className="mt-1 mb-0 text-mute">Here is what is happening on Waterline today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Only when the numbers come from simulated records (`is_sample`); real orders are not sample data. */}
          {d?.is_sample && <SampleTag>SAMPLE DATA</SampleTag>}
          <span className="flex h-[42px] items-center gap-2 rounded-input bg-white px-3.5 font-bold shadow-stat">
            <CalendarIcon size={18} />
            {formatDayDate(new Date())}
          </span>
          {ORDER_FOR_CUSTOMER_ENABLED && (
            <ButtonLink to="/admin/orders/new" size="sm" block={false}>
              + Create order
            </ButtonLink>
          )}
        </div>
      </div>

      {dash.isPending && <LoadingBlock label="Loading today's numbers" />}
      {dash.isError && <ErrorBlock error={dash.error} onRetry={() => dash.refetch()} />}
      {d && (
        <div className="rise-2 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
          <StatCard tone="blue" icon={<DocumentLinesIcon size={24} />} value={d.orders.total} label="Orders today" note="Including open orders" />
          <StatCard
            tone="gold"
            icon={<ClockIcon size={24} />}
            value={d.orders.awaiting_rider}
            label="Awaiting rider"
            note={d.orders.oldest_waiting_minutes !== null ? `Oldest ${d.orders.oldest_waiting_minutes} min` : 'None waiting'}
            valueClassName="text-[#B45309]"
          />
          <StatCard tone="teal" icon={<NavigationIcon size={24} />} value={d.orders.in_progress} label="In progress" />
          <StatCard tone="green" icon={<CheckIcon size={24} />} value={d.orders.delivered} label="Delivered" noteTone="green" note="Code verified" />
          <StatCard tone="red" icon={<CloseIcon size={24} />} value={d.orders.cancelled} label="Cancelled" note={`${d.disputes_open} issues open`} noteTone="red" />
          <StatCard tone="blue" icon={<VehicleIcon size={24} />} value={d.riders_online.total} label="Riders online" note={`${d.riders_online.keke} Keke · ${d.riders_online.tanker} Tanker`} />
          <StatCard tone="teal" icon={<StationDoorIcon size={24} />} value={d.stations.open} label="Refill stations open" note={`${d.stations.closed} closed`} />
          <StatCard tone="green" icon={<TrendUpIcon size={24} strokeWidth={2.2} roundJoin={false} />} value={formatNaira(d.revenue_today_minor_units)} label="Revenue today" note={d.is_sample ? 'Delivered orders, SAMPLE' : undefined} />
          {/* The backend sends neither (payouts are out of the MVP, transfers are not verified in the pilot): hidden, never shown as zero. */}
          {d.payouts_due && <StatCard tone="violet" icon={<WalletOutlineIcon size={24} />} value={formatNaira(d.payouts_due.amount_minor_units)} label="Rider payouts due" note={`${d.payouts_due.riders} riders`} />}
          {d.payments_to_verify !== undefined && <StatCard tone="gold" icon={<CreditCardIcon size={24} />} value={d.payments_to_verify} label="Payments to verify" note="Transfers awaiting check" noteTone="amber" />}
        </div>
      )}

      <div className="rise-3 flex flex-wrap gap-3.5">
        <Panel title="Live map: riders and deliveries" action={<MapLegend />} className="min-w-0 flex-[999_1_520px]">
          {map.data ? <AdminMap data={map.data} /> : map.isError ? <ErrorBlock error={map.error} onRetry={() => map.refetch()} /> : <LoadingBlock label="Loading the map" />}
          <p className="m-0 text-chip text-mute">Positions are drawn by station and area, not live GPS.</p>
        </Panel>
        <Panel title="Orders by status" className="flex-[1_1_260px]">
          {d && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <Donut segs={segs} total={total} />
                <div className="flex min-w-[120px] flex-1 flex-col gap-2 text-[13px]">
                  {segs.map((s) => (
                    <span key={s.label} className="flex items-center gap-2">
                      <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden="true" />
                      {s.label}
                      <b className="ml-auto">{s.value}</b>
                    </span>
                  ))}
                </div>
              </div>
              <div className="h-px bg-line" />
              <h3 className="m-0 text-[15px] font-extrabold">Delivery type</h3>
              {(['keke', 'tanker'] as const).map((t) => {
                const n = d.by_type[t]
                const pct = total ? Math.round((n / total) * 100) : 0
                return (
                  <div key={t} className="text-[13px]">
                    <div className="flex justify-between">
                      <span>{t === 'keke' ? 'Keke' : 'Tanker'}</span>
                      <b>
                        {n} ({pct}%)
                      </b>
                    </div>
                    <div className="mt-1.5 h-2.5 rounded-[6px] bg-[#EEF2F7]">
                      <div className="h-full rounded-[6px] transition-[width] duration-700" style={{ width: `${pct}%`, background: t === 'keke' ? '#1570D8' : '#7C3AED' }} />
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent activity"
        className="rise-4"
        action={
          <Link to="/admin/settings#audit" className="text-[14px] font-bold text-primary no-underline hover:text-primary-dark">
            View all
          </Link>
        }
      >
        {activity.isPending && <LoadingBlock lines={2} label="Loading activity" />}
        {activity.isError && <ErrorBlock error={activity.error} onRetry={() => activity.refetch()} />}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {activity.data?.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <IconBadge tone={ACTIVITY[a.kind].tone} size={34} radius={17}>
                {ACTIVITY[a.kind].icon}
              </IconBadge>
              <div>
                <div className="text-[14px] font-bold">{a.text}</div>
                <div className="text-chip text-mute">{timeAgo(a.at)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="rise-5 flex flex-wrap gap-3.5">
        <Panel
          title="Recent orders"
          className="min-w-0 flex-[999_1_560px]"
          action={
            <Link to="/admin/orders" className="text-[14px] font-bold text-primary no-underline hover:text-primary-dark">
              View all
            </Link>
          }
        >
          {recent.isError && <ErrorBlock error={recent.error} onRetry={() => recent.refetch()} />}
          <div className="overflow-x-auto">
            <DataTable<AdminOrder>
              caption="Recent orders"
              rows={recent.data?.orders.slice(0, 5) ?? []}
              rowKey={(o) => o.reference}
              empty="No orders yet."
              columns={[
                { header: 'Order', cell: (o) => <span className="font-extrabold">{o.reference}</span> },
                { header: 'Customer', cell: (o) => o.customer_name },
                {
                  header: 'Type',
                  cell: (o) =>
                    o.choice ? (
                      <span className={o.choice.delivery_type === 'keke' ? 'font-bold text-primary' : 'font-bold text-violet'}>{o.choice.delivery_type === 'keke' ? 'Keke' : 'Tanker'}</span>
                    ) : (
                      <span className="text-mute">Not recorded</span>
                    ),
                },
                { header: 'Quantity', cell: (o) => o.quantity },
                { header: 'Amount', cell: (o) => (o.total_minor_units === null ? 'Quote' : formatNaira(o.total_minor_units)) },
                { header: 'Status', cell: (o) => <StatusChip status={o.status} /> },
                { header: 'Rider', cell: (o) => o.partner?.name ?? <span className="text-mute">None yet</span> },
                {
                  header: 'Action',
                  cell: (o) => (
                    <MiniLink to={`/admin/orders?ref=${o.reference}`} tone={o.status === 'awaiting_rider' ? 'primary' : 'alt'}>
                      {o.status === 'awaiting_rider' ? 'Assign' : 'View'}
                    </MiniLink>
                  ),
                },
              ]}
            />
          </div>
        </Panel>
        <Panel
          title="Refill stations"
          className="flex-[1_1_300px]"
          action={
            STATIONS_PAGE_ENABLED && (
              <Link to="/admin/stations" className="text-[14px] font-bold text-primary no-underline hover:text-primary-dark">
                Manage
              </Link>
            )
          }
        >
          {USE_MOCKS && stations.isError && <ErrorBlock error={stations.error} onRetry={() => stations.refetch()} />}
          {!USE_MOCKS && map.isError && <ErrorBlock error={map.error} onRetry={() => map.refetch()} />}
          <ul className="m-0 flex list-none flex-col p-0">
            {USE_MOCKS
              ? stations.data?.map((st) => (
                  <li key={st.id} className="flex items-center justify-between gap-2 border-0 border-b border-solid border-row-line py-2.5 last:border-b-0">
                    <span className="font-bold">{st.name}</span>
                    <span className="text-[13px] whitespace-nowrap text-mute">{st.loading_now} active</span>
                    <Chip tone={st.open ? 'green' : 'red'}>{st.open ? 'Open' : 'Closed'}</Chip>
                  </li>
                ))
              : map.data?.stations.map((st) => (
                  <li key={st.id} className="flex items-center justify-between gap-2 border-0 border-b border-solid border-row-line py-2.5 last:border-b-0">
                    <span className="font-bold">{st.name}</span>
                    <Chip tone={st.open ? 'green' : 'red'}>{st.open ? 'Open' : 'Closed'}</Chip>
                  </li>
                ))}
          </ul>
        </Panel>
      </div>
    </AdminFrame>
  )
}

/** "Orders by status" ring (design SVG: r 50, 16 px stroke). */
function Donut({ segs, total }: { segs: { label: string; value: number; color: string }[]; total: number }) {
  const C = 2 * Math.PI * 50
  // Each segment starts where the ones before it end.
  const starts = segs.map((_, i) => segs.slice(0, i).reduce((sum, x) => sum + (total ? (x.value / total) * C : 0), 0))
  const desc = segs.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ')
  return (
    <div className="relative size-[140px]">
      <svg aria-label={`Orders by status: ${desc}`} role="img" height="140" width="140" viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" fill="none" r="50" stroke="#EEF2F7" strokeWidth="16" />
        {total > 0 &&
          segs.map((s, i) => (
            <circle key={s.label} cx="60" cy="60" fill="none" r="50" stroke={s.color} strokeDasharray={`${(s.value / total) * C} ${C}`} strokeDashoffset={-starts[i]} strokeWidth="16" />
          ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] font-extrabold">{total}</span>
        <span className="text-[11.5px] text-mute">orders</span>
      </div>
    </div>
  )
}
