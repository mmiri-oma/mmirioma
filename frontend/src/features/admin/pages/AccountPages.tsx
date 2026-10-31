import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { DataTable } from '../../../components/ui/Admin'
import { Avatar } from '../../../components/ui/Avatar'
import { Button, ButtonLink } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { KeyValue } from '../../../components/ui/Content'
import { TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { AdminSettings, StaffMember } from '../../../domain/admin'
import { errorMessage } from '../../../lib/api/errorMessage'
import { lazyMock } from '../../../lib/api/lazyMock'
import { USE_MOCKS } from '../../../lib/api/mode'
import { cx } from '../../../lib/cx'
import { formatDateTime } from '../../../lib/format/datetime'
import { formatPhone } from '../../../lib/format/phone'
import { useLogout } from '../../auth/useSession'
import * as api from '../adminApi'
import { timeAgo } from '../adminFormat'
import { AdminMap, MapLegend } from '../AdminMap'
import { AdminFrame, PageHead, Panel, StatusChip } from '../AdminParts'
import { useAdminAccount, useAdminMutation, useAdminNotifications, useAdminOrders, useAudit, useLiveMap, useSettings } from '../queries'


/** The sample database loads only in mock mode, and is not part of a build without mocks (#236). */
const mockDb = lazyMock(__USE_MOCKS__ && (() => import('../../../mocks/db')))
/**
 * Settings (added): the operations values the designs leave as placeholders
 * (`[SUPPORT HOURS]`, `[CODE TIME LIMIT]`, `[SAFE LOAD]`), the staff list and
 * the full audit log (`#audit`, from the dashboard's "View all").
 */
export function Settings() {
  const settings = useSettings()
  const audit = useAudit()
  const [resetting, setResetting] = useState(false)
  return (
    <AdminFrame searchPlaceholder="Search settings">
      <PageHead title="Settings" sub="Operations details, staff and the audit log." />
      {settings.isPending && <LoadingBlock label="Loading settings" />}
      {settings.isError && <ErrorBlock error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && (
        <div className="rise-2 grid gap-4 xl:grid-cols-2">
          {/* The real API has no save endpoint (admin-operations.md, decision 4): read only, with nothing the backend does not send. */}
          {USE_MOCKS ? <OperationsForm key={JSON.stringify(settings.data.settings)} initial={settings.data.settings} /> : <OperationsReadOnly settings={settings.data.settings} />}
          <Panel title="Staff">
            <DataTable<StaffMember>
              caption="Staff accounts"
              rows={settings.data.staff}
              rowKey={(m) => m.id}
              columns={[
                {
                  header: 'Name',
                  cell: (m) => (
                    <span className="flex items-center gap-2">
                      <Avatar name={m.name} size={30} /> <b>{m.name}</b>
                    </span>
                  ),
                },
                { header: 'Role', cell: (m) => m.role },
                { header: 'Phone', cell: (m) => formatPhone(m.phone) },
                { header: USE_MOCKS ? 'Last active' : 'Last sign-in', cell: (m) => (m.last_active ? timeAgo(m.last_active) : 'Never signed in') },
              ]}
            />
            <p className="m-0 text-caption text-mute">Staff accounts are created by the team's command-line tool (auth.md), not from this page.</p>
          </Panel>
        </div>
      )}
      {USE_MOCKS && (
        <Panel title="Sample data (mock mode only)" className="rise-3">
          <p className="m-0 text-[14px] text-slate">
            Put every order, rider, station, price and notification back to the starting samples, for all three apps in this browser. You will be signed out.
          </p>
          <Button
            variant="line-danger"
            size="sm"
            block={false}
            className="self-start px-5"
            onClick={() => setResetting(true)}
          >
            Reset sample data
          </Button>
          <ConfirmDialog
            open={resetting}
            title="Reset all sample data?"
            confirmLabel="Reset data"
            onCancel={() => setResetting(false)}
            onConfirm={() => {
              void mockDb.resetMockDb().then(() => window.location.assign('/admin/login'))
            }}
          >
            Everything you added or changed in the three apps in this browser goes back to the starting samples, and you are signed out. You cannot undo this.
          </ConfirmDialog>
        </Panel>
      )}
      <Panel title="Audit log" className="rise-3">
        <div id="audit" className="overflow-x-auto">
          {audit.isPending && <LoadingBlock lines={3} label="Loading the audit log" />}
          {audit.isError && <ErrorBlock error={audit.error} onRetry={() => audit.refetch()} />}
          {audit.data && (
            <DataTable
              caption="Audit log"
              rows={audit.data}
              rowKey={(a) => a.id}
              empty="Nothing logged yet."
              columns={[
                { header: 'When', cell: (a) => formatDateTime(a.at) },
                { header: 'Who', cell: (a) => a.actor },
                {
                  header: 'What',
                  cell: (a) => (
                    <>
                      <b>{a.action}</b>
                      {a.target && <span className="block text-caption text-mute">{a.target}</span>}
                    </>
                  ),
                  className: 'whitespace-normal',
                },
                { header: 'Reason', cell: (a) => a.reason ?? <span className="text-mute">None</span>, className: 'whitespace-normal' },
              ]}
            />
          )}
        </div>
      </Panel>
    </AdminFrame>
  )
}

/**
 * The operations settings as the real API sends them (`GET /admin/settings`):
 * the support number and the delivery code limit, read only. Support hours and
 * safe load have no source, so they are not shown (no bracket placeholders);
 * changing a value is a configuration change by the team.
 */
function OperationsReadOnly({ settings }: { settings: AdminSettings }) {
  return (
    <Panel title="Operations">
      <KeyValue label="Support phone" value={settings.support_phone ? formatPhone(settings.support_phone) : 'Not set'} />
      <KeyValue label="Delivery code time limit" value={settings.code_time_limit ?? 'Not set'} />
      <p className="m-0 text-caption text-mute">These come from the server's settings (FR-055) and are changed by the team, not from this page.</p>
    </Panel>
  )
}

function OperationsForm({ initial }: { initial: AdminSettings }) {
  const [v, setV] = useState(initial)
  const save = useAdminMutation(() => api.saveSettings(v))
  const field = (label: string, value: string | null, placeholder: string, onChange: (s: string) => void, hint?: string) => (
    <TextField label={label} optional value={value ?? ''} placeholder={placeholder} hint={hint} onChange={(e) => onChange(e.target.value)} />
  )
  return (
    <Panel title="Operations">
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(undefined)
        }}
      >
        {field('Support phone', v.support_phone, '0800 000 0000', (s) => setV({ ...v, support_phone: s }), 'Shown in the apps instead of the placeholder number.')}
        {field('Support hours', v.support_hours, '[SUPPORT HOURS]', (s) => setV({ ...v, support_hours: s }), 'e.g. Mon to Sat, 7 AM to 7 PM')}
        {field('Delivery code time limit', v.code_time_limit, '[CODE TIME LIMIT]', (s) => setV({ ...v, code_time_limit: s }), 'How long a delivery code lasts, e.g. 24 hours')}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Safe load, Keke', v.safe_load.keke, '[SAFE LOAD]', (s) => setV({ ...v, safe_load: { ...v.safe_load, keke: s } }))}
          {field('Safe load, tanker', v.safe_load.tanker, '[SAFE LOAD]', (s) => setV({ ...v, safe_load: { ...v.safe_load, tanker: s } }))}
        </div>
        {save.isError && <Notice tone="error">{errorMessage(save.error)}</Notice>}
        {save.isSuccess && <Notice tone="success">Saved.</Notice>}
        <Button type="submit" size="sm" block={false} className="self-start px-5" loading={save.isPending}>
          Save settings
        </Button>
        <p className="m-0 text-caption text-mute">
          These are open decisions (PRD §13) and keep showing as bracket placeholders until they are agreed and connected. The support number and
          WhatsApp come from the server's settings (FR-055), not from this form.
        </p>
      </form>
    </Panel>
  )
}

/** Admin notifications (the header bell). */
export function AdminNotifications() {
  const list = useAdminNotifications()
  const mark = useAdminMutation(() => api.markAdminNotificationsRead())
  const unread = list.data?.filter((n) => !n.read).length ?? 0
  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders">
      <PageHead
        title="Notifications"
        sub={unread ? `${unread} new` : 'You are up to date.'}
        actions={
          unread > 0 && (
            <Button size="sm" block={false} variant="alt" loading={mark.isPending} onClick={() => mark.mutate(undefined)}>
              Mark all as read
            </Button>
          )
        }
      />
      {list.isPending && <LoadingBlock label="Loading notifications" />}
      {list.isError && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {list.data?.length === 0 && <Card className="p-4 text-mute">No notifications yet.</Card>}
      <ul className="rise-2 m-0 flex list-none flex-col gap-2.5 p-0">
        {list.data?.map((n) => (
          <li key={n.id}>
            <Link to={n.link} className={cx('flex items-start gap-3 rounded-card border border-solid bg-white p-4 text-ink no-underline shadow-stat hover:text-ink', n.read ? 'border-transparent' : 'border-[#BFDBFE]')}>
              <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} aria-hidden="true" />
              <span className="flex-1">
                <span className="block font-extrabold">
                  {n.title}
                  {!n.read && <span className="sr-only"> (new)</span>}
                </span>
                <span className="block text-[14px] text-slate">{n.body}</span>
              </span>
              <span className="shrink-0 text-chip text-mute">{timeAgo(n.at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </AdminFrame>
  )
}

/** The signed-in staff member (header profile link). */
export function AdminAccount() {
  const navigate = useNavigate()
  const account = useAdminAccount()
  const logout = useLogout()
  const [leaving, setLeaving] = useState(false)
  const a = account.data
  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders">
      <PageHead title="My account" />
      {account.isPending && <LoadingBlock label="Loading your account" />}
      {account.isError && <ErrorBlock error={account.error} onRetry={() => account.refetch()} />}
      {a && (
        <Card className="rise-2 flex max-w-[560px] flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={a.name} size={64} fontSize={22} />
            <div>
              <div className="text-[20px] font-extrabold">{a.name}</div>
              <div className="text-mute">{a.role}</div>
            </div>
          </div>
          <div className="text-[14px]">
            <KeyValue label="Phone (sign-in)" value={formatPhone(a.phone)} />
            <KeyValue label="Role" value={a.role} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/admin/password" variant="alt" size="sm" block={false} className="px-5">
              Change password
            </ButtonLink>
            <Button variant="line-danger" size="sm" block={false} className="px-5" onClick={() => setLeaving(true)}>
              Log out
            </Button>
            <ConfirmDialog
              open={leaving}
              title="Log out of MmiriOma admin?"
              confirmLabel="Log out"
              loading={logout.isPending}
              onCancel={() => setLeaving(false)}
              onConfirm={() => logout.mutate(undefined, { onSettled: () => navigate('/admin/login', { replace: true }) })}
            >
              You will need your phone number and password to sign in again.
            </ConfirmDialog>
          </div>
        </Card>
      )}
    </AdminFrame>
  )
}

/** Full map (dashboard "Open full map"): the drawn map larger, with the active deliveries listed. */
export function LiveMapPage() {
  const map = useLiveMap()
  const active = useAdminOrders('in_progress', '')
  return (
    <AdminFrame searchPlaceholder="Search orders, customers, riders">
      <PageHead title="Live map" sub="Riders and deliveries in progress. Drawn by station and area, not live GPS." actions={<MapLegend />} />
      <Card className="rise-2 p-3">
        {map.data ? <AdminMap data={map.data} height={520} fullMapLink={false} /> : map.isError ? <ErrorBlock error={map.error} onRetry={() => map.refetch()} /> : <LoadingBlock label="Loading the map" />}
      </Card>
      <Panel title="In progress" className="rise-3">
        <div className="overflow-x-auto">
          <DataTable
            caption="Deliveries in progress"
            rows={active.data?.orders ?? []}
            rowKey={(o) => o.reference}
            empty="Nothing in progress."
            columns={[
              { header: 'Order', cell: (o) => <Link to={`/admin/orders?ref=${o.reference}`} className="font-extrabold text-primary-dark no-underline hover:underline">{o.reference}</Link> },
              { header: 'Rider', cell: (o) => (o.partner ? (o.partner.code ? `${o.partner.name} · ${o.partner.code}` : o.partner.name) : 'None') },
              { header: 'From', cell: (o) => o.station_name },
              { header: 'To', cell: (o) => o.area },
              { header: 'Status', cell: (o) => <StatusChip status={o.status} /> },
            ]}
          />
        </div>
      </Panel>
    </AdminFrame>
  )
}
