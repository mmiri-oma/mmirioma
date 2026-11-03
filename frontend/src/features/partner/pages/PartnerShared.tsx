/**
 * Partner screens shared by the Keke rider and tanker driver apps: order
 * history (`r-history`), notifications (`r-notifications`), vehicle and papers
 * (`r-vehicle`), report a problem (`r-issue`) and decline an assigned order
 * (added, decision 13). The tanker menu reuses these with tanker words
 * (decision 18).
 */
import { useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import {
  AlertTriangleIcon,
  BellOutlineIcon,
  CheckIcon,
  ClockIcon,
  LockSquareIcon,
  PageIcon,
  PhoneIcon,
  PinOutlineIcon,
  ShieldIcon,
  StationIcon,
  VehicleSmallIcon,
  WalletOutlineIcon,
} from '../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { MiniButton } from '../../../components/ui/Admin'
import { Button, ButtonLink } from '../../../components/ui/Button'
import { Card, CardLink } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { IconBadge, SectionTitle, type IconBadgeTone } from '../../../components/ui/Content'
import { Pills } from '../../../components/ui/Controls'
import { TextAreaField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { describeQuantity, gallonsFromLitres, litresFromGallons } from '../../../domain/quantity'
import { DECLINE_LABEL, ENDED_STAGE_LABEL, ISSUE_LABEL, type DeclineReason, type PartnerIssueType, type PartnerJob, type PartnerNotification } from '../../../domain/partner'
import { errorMessage } from '../../../lib/api/errorMessage'
import { cx } from '../../../lib/cx'
import { PARTNER_DOCUMENTS_ENABLED } from '../../../lib/features'
import { formatNaira } from '../../../lib/format/money'
import { JobMiniCard } from '../components/JobParts'
import { END_REASON_LABEL, jobDeliveryType, jobEndedAt, jobQuantity, jobShort, relativeWhen, totalLitres } from '../jobHelpers'
import { TRIP_STEP_LINE, tripStep, tripStepPath, usePartnerApp } from '../partnerContext'
import { useActiveJobs, useDeclineJob, useHistory, useJob, useMarkPartnerNotificationsRead, usePartnerNotifications, usePartnerProfile, useReportIssue, useUploadDocument } from '../queries'

function TitleBar({ back, title, right }: { back: string; title: string; right?: ReactNode }) {
  return <TopBar left={<BackLink to={back} />} center={<TopBarTitle>{title}</TopBarTitle>} right={right ?? <TopBarSpacer />} />
}

/* ---------- Order history (r-history) ---------- */

type Period = 'today' | 'week' | 'month'
const PERIOD_MS: Record<Period, number> = { today: 0, week: 7 * 86_400_000, month: 31 * 86_400_000 }

function inPeriod(job: PartnerJob, period: Period, now = Date.now()): boolean {
  // A failed or cancelled job counts from the time it ended.
  const endedAt = jobEndedAt(job)
  if (!endedAt) return false
  const t = Date.parse(endedAt)
  if (period === 'today') return new Date(t + 3_600_000).toISOString().slice(0, 10) === new Date(now + 3_600_000).toISOString().slice(0, 10)
  return now - t <= PERIOD_MS[period]
}

export function PartnerHistory() {
  const { base, vehicle } = usePartnerApp()
  const history = useHistory()
  const [period, setPeriod] = useState<Period>('week')
  const list = (history.data ?? []).filter((j) => inPeriod(j, period))
  const delivered = list.filter((j) => j.stage === 'delivered')
  // Partner pay is out of the MVP (partners.md, decision 7): with the real
  // API no job carries an amount, so the "Earned" figure is left out rather
  // than shown as ₦0. An empty list (no trips in the period, or the history
  // still loading) has no amount to show either, so it needs a job to show one.
  const known = list.length > 0 && list.every((j) => j.earning_minor_units !== null)
  const amount = delivered.reduce((a, j) => a + (j.earning_minor_units ?? 0), 0)
  const volume = totalLitres(delivered)
  const short = amount >= 1_000_000 ? `₦${Math.round(amount / 100_000)}k` : formatNaira(amount)

  return (
    <MobileShell>
      <TitleBar back={`${base}/menu`} title={vehicle === 'keke' ? 'Order history' : 'Trip history'} />
      <ScrollArea className="gap-3">
        <Pills
          className="rise-1"
          wrap={false}
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
          ]}
        />
        <div className={cx('rise-2 grid gap-2', known ? 'grid-cols-3' : 'grid-cols-2')}>
          <Card className="p-3 text-center">
            <div className="text-[20px] font-extrabold">{delivered.length}</div>
            <div className="text-chip text-mute">Trips</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[20px] font-extrabold">{(vehicle === 'keke' ? volume : gallonsFromLitres(volume)).toLocaleString('en-NG')}</div>
            <div className="text-chip text-mute">
              {vehicle === 'keke'
                ? `Litres · ${gallonsFromLitres(volume).toLocaleString('en-NG')} gal`
                : `Gallons · ${volume.toLocaleString('en-NG')} L`}
            </div>
          </Card>
          {known && (
            <Card className="border-[#C8F0D6] bg-[#E7F9EE] p-3 text-center">
              <div className="text-[20px] font-extrabold text-green">{short}</div>
              <div className="text-chip text-slate">Earned</div>
            </Card>
          )}
        </div>
        {history.isPending && <LoadingBlock />}
        {history.isError && <ErrorBlock error={history.error} onRetry={() => history.refetch()} />}
        {history.isSuccess && list.length === 0 && <EmptyBlock illustration="keke" title="No trips in this period" text="Finished trips show here." />}
        {list.map((j) => (
          <Card key={j.reference} className="rise-3 flex items-center gap-3 p-3">
            <span className="flex h-[52px] w-16 shrink-0 items-center justify-center rounded-icon bg-sky">
              <Illustration name={jobDeliveryType(j, vehicle)} className="w-14" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-extrabold">{jobQuantity(j)}</div>
              <div className="text-chip text-mute">{jobShort(j)}</div>
              <div className="text-chip text-mute">{jobEndedAt(j) ? relativeWhen(jobEndedAt(j)!) : ''}</div>
              {j.stage === 'failed' && j.end_reason && END_REASON_LABEL[j.end_reason] && (
                <div className="text-chip text-mute">Reason: {END_REASON_LABEL[j.end_reason]}</div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              {j.earning_minor_units !== null && (
                <span className="font-extrabold">{formatNaira(j.stage === 'delivered' ? j.earning_minor_units : 0)}</span>
              )}
              {/* Failed and disputed jobs are shown, never hidden (@chidimmamogbo on #12). */}
              <Chip tone={j.stage === 'delivered' ? 'green' : j.stage === 'under_review' ? 'amber' : 'red'} className="px-2 py-0.5 text-[11px]">
                {ENDED_STAGE_LABEL[j.stage] ?? 'Ended'}
              </Chip>
            </div>
          </Card>
        ))}
        {list.length > 0 && known && <p className="m-0 text-center text-chip text-mute">Sample amounts.</p>}
      </ScrollArea>
    </MobileShell>
  )
}

/* ---------- Notifications (r-notifications) ---------- */

const NOTE_STYLE: Record<PartnerNotification['kind'], { tone: IconBadgeTone; icon: ReactNode }> = {
  assigned: { tone: 'blue', icon: <BellOutlineIcon size={20} /> },
  new_orders: { tone: 'teal', icon: <PageIcon size={20} /> },
  payout: { tone: 'green', icon: <WalletOutlineIcon size={20} /> },
  station_closed: { tone: 'red', icon: <StationIcon size={20} /> },
  papers_due: { tone: 'gold', icon: <ShieldIcon size={20} /> },
  reassigned: { tone: 'red', icon: <BellOutlineIcon size={20} /> },
  account: { tone: 'blue', icon: <ShieldIcon size={20} /> },
}

export function PartnerNotifications() {
  const { base } = usePartnerApp()
  const notes = usePartnerNotifications()
  const mark = useMarkPartnerNotificationsRead()
  const items = notes.data?.items ?? []
  // The server's count: unread messages may be older than the page shown.
  const unread = notes.data?.unread_count ?? 0
  const target = (n: PartnerNotification) =>
    n.kind === 'assigned' && n.reference
      ? `${base}/assigned/${n.reference}`
      : n.kind === 'payout'
        ? `${base}/earnings`
        : n.kind === 'papers_due'
          ? `${base}/vehicle`
          : n.kind === 'account'
            ? `${base}/profile`
            : n.kind === 'reassigned'
              ? `${base}/history`
              : `${base}/orders`
  return (
    <MobileShell>
      <TitleBar
        back={base}
        title="Notifications"
        right={
          <button
            type="button"
            disabled={unread === 0 || mark.isPending}
            onClick={() => mark.mutate()}
            className="cursor-pointer border-0 bg-transparent px-1 py-2.5 text-[13px] font-bold text-primary disabled:cursor-default disabled:text-mute"
          >
            Mark all read
          </button>
        }
      />
      <ScrollArea className="gap-2.5">
        {notes.isPending && <LoadingBlock />}
        {notes.isError && <ErrorBlock error={notes.error} onRetry={() => notes.refetch()} />}
        {notes.isSuccess && items.length === 0 && <EmptyBlock title="No notifications" text="New orders and payouts show here." />}
        {items.map((n) => {
          const st = NOTE_STYLE[n.kind]
          return (
            <CardLink key={n.id} to={target(n)} className={cx('rise-2 flex items-start gap-3 px-3.5 py-3', !n.read && 'border-[#D4ECEF] bg-[#F2F8FF]')}>
              <IconBadge tone={st.tone}>{st.icon}</IconBadge>
              <span className="flex flex-1 flex-col">
                <span className="text-[14px] font-extrabold">{n.title}</span>
                <span className="text-[13px] text-slate">{n.body}</span>
                <span className="mt-0.5 text-tab text-mute">{minutesAgo(n.at)}</span>
              </span>
              {!n.read && <span role="img" aria-label="Unread" className="glow mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />}
            </CardLink>
          )
        })}
      </ScrollArea>
    </MobileShell>
  )
}

/** "2 min ago", "1 h ago", "Yesterday", "Mon". */
function minutesAgo(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60_000)
  if (m < 60) return `${Math.max(1, m)} min ago`
  if (m < 12 * 60) return `${Math.round(m / 60)} h ago`
  return relativeWhen(iso).split(',')[0]
}

/* ---------- Vehicle and papers (r-vehicle) ---------- */

export function PartnerVehicle() {
  const { base, vehicle } = usePartnerApp()
  const profile = usePartnerProfile()
  const upload = useUploadDocument()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const p = profile.data
  const approvalChip =
    p?.approval === 'approved' ? (
      <Chip tone="green" className="absolute top-3.5 left-3.5 bg-white">
        <span aria-hidden="true" className="glow size-2 rounded-full bg-green-solid" />
        Approved
      </Chip>
    ) : p?.approval === 'pending' ? (
      <Chip tone="amber" className="absolute top-3.5 left-3.5 bg-white">
        Waiting for approval
      </Chip>
    ) : (
      <Chip tone="red" className="absolute top-3.5 left-3.5 bg-white">
        Suspended
      </Chip>
    )
  const docIcon = (status: string) =>
    status === 'valid' || status === 'done' ? (
      <IconBadge tone="green" size={36}>
        <CheckIcon size={18} strokeWidth={2.6} roundJoin={false} />
      </IconBadge>
    ) : (
      <IconBadge tone="gold" size={36}>
        <ClockIcon size={18} strokeWidth={2.2} roundJoin={false} />
      </IconBadge>
    )

  return (
    <MobileShell>
      <TitleBar back={`${base}/menu`} title={vehicle === 'keke' ? 'Vehicle details' : 'Tanker and papers'} />
      <ScrollArea className="gap-3">
        {profile.isPending && <LoadingBlock />}
        {profile.isError && <ErrorBlock error={profile.error} onRetry={() => profile.refetch()} />}
        {p && (
          <>
            <div className="rise-1 relative overflow-hidden rounded-hero bg-[linear-gradient(160deg,#EEF6FF,#D4ECEF)] p-4 text-center">
              {approvalChip}
              <Illustration name={vehicle} alt={vehicle === 'keke' ? 'Your keke' : 'Your tanker'} className="animate-drive mx-auto mt-4 w-[230px]" />
              <div className="mt-1.5 text-[20px] font-extrabold">
                {vehicle === 'keke' ? 'Keke' : 'Tanker'} · {p.vehicle.plate}
              </div>
              <div className="text-[13px] text-slate">
                {p.vehicle.description} · {vehicle === 'keke' ? 'rider' : 'driver'} since{' '}
                {new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(p.partner_since))}
              </div>
            </div>
            <Card className="rise-2 px-4 py-1">
              <div className="mo-li">
                <span className="flex-1 text-mute">Delivery type</span>
                <b>{vehicle === 'keke' ? 'Keke (jerrycans)' : `Tanker (${p.vehicle.tank_gallons ? describeQuantity(litresFromGallons(p.vehicle.tank_gallons), 'gallons', 'short') : 'size not set'})`}</b>
              </div>
              <div className="mo-li">
                <span className="flex-1 text-mute">Verified safe load</span>
                <b>{p.vehicle.safe_load_litres ? `${p.vehicle.safe_load_litres.toLocaleString('en-NG')} L` : '[SAFE LOAD] L'}</b>
              </div>
              <div className="mo-li">
                <span className="flex-1 text-mute">Can pour into</span>
                <b>{p.vehicle.can_pour_into}</b>
              </div>
              <div className="mo-li">
                <span className="flex-1 text-mute">Service area</span>
                <span className="flex gap-1.5">
                  {p.service_areas.map((a) => (
                    <Chip key={a} className="px-2 py-[3px]">
                      {a}
                    </Chip>
                  ))}
                </span>
              </div>
            </Card>
            {/* Documents are out of the MVP: the admin checks papers in person (#221). */}
            {PARTNER_DOCUMENTS_ENABLED && (
              <>
                <SectionTitle className="rise-3">Documents</SectionTitle>
                <Card className="rise-3 px-4 py-1">
                  {p.documents.map((d) => (
                    <div key={d.id} className="mo-li">
                      {docIcon(d.status)}
                      <div className="flex-1">
                        <div className="font-bold">{d.name}</div>
                        <div className={cx('text-chip', d.status === 'expiring' || d.status === 'missing' ? 'text-amber' : 'text-mute')}>{d.note}</div>
                      </div>
                      {d.status === 'valid' && <Chip tone="green" className="px-2 py-[3px]">Valid</Chip>}
                      {d.status === 'done' && <Chip tone="green" className="px-2 py-[3px]">Done</Chip>}
                      {d.status === 'checking' && <Chip tone="blue" className="px-2 py-[3px]">Checking</Chip>}
                      {(d.status === 'expiring' || d.status === 'missing') && d.can_upload && (
                        <MiniButton
                          disabled={upload.isPending}
                          onClick={() => {
                            setDocId(d.id)
                            fileRef.current?.click()
                          }}
                        >
                          Upload
                        </MiniButton>
                      )}
                    </div>
                  ))}
                </Card>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f && docId) upload.mutate({ id: docId, fileName: f.name })
                    e.target.value = ''
                  }}
                />
                {upload.isSuccess && <Notice tone="success">Uploaded. Admin will check it.</Notice>}
                {upload.isError && <Notice tone="error">{errorMessage(upload.error)}</Notice>}
              </>
            )}
            <p className="rise-4 m-0 text-caption text-mute">
              Only approved {vehicle === 'keke' ? 'riders' : 'drivers'} with valid papers can receive orders. Changes to your {vehicle} are checked by admin.
            </p>
          </>
        )}
      </ScrollArea>
    </MobileShell>
  )
}

/* ---------- Report a problem (r-issue) ---------- */

const ISSUE_STYLE: Record<PartnerIssueType, { tone: IconBadgeTone; icon: ReactNode }> = {
  customer_unreachable: { tone: 'blue', icon: <PhoneIcon size={17} strokeWidth={2.2} /> },
  unsafe_pour: { tone: 'red', icon: <AlertTriangleIcon size={17} strokeWidth={2.2} /> },
  bad_address: { tone: 'violet', icon: <PinOutlineIcon size={17} strokeWidth={2.2} /> },
  station_problem: { tone: 'teal', icon: <StationIcon size={17} strokeWidth={2.2} /> },
  vehicle_breakdown: { tone: 'gold', icon: <VehicleSmallIcon size={17} strokeWidth={2.2} /> },
  code_not_working: { tone: 'green', icon: <LockSquareIcon size={17} strokeWidth={2.2} /> },
}

export function PartnerIssue() {
  const { base, vehicle } = usePartnerApp()
  const [params] = useSearchParams()
  const active = useActiveJobs()
  const report = useReportIssue()
  const ref = params.get('ref')
  const job = ref ? active.data?.find((j) => j.reference === ref) : active.data?.find((j) => j.stage === 'collected' || j.stage === 'accepted')
  const initial = (params.get('type') as PartnerIssueType | null) ?? 'customer_unreachable'
  const [type, setType] = useState<PartnerIssueType>(initial in ISSUE_LABEL ? initial : 'customer_unreachable')
  const [note, setNote] = useState('')
  // The list rows carry no arrival fields (real API), so the step comes from the job's own detail (#257).
  const detail = useJob(job?.reference ?? '')
  const step = job ? tripStep(detail.data ?? job) : null
  const back = job && step ? tripStepPath(base, job.reference, step) : `${base}/menu`
  // After arrival the report cannot record the attempts FR-038 asks for, so "Customer not reachable" opens U3 instead (U5).
  const opensAttempts = step === 'arrived' && type === 'customer_unreachable'

  return (
    <MobileShell>
      <TitleBar back={back} title={job ? 'Report a problem' : 'Support'} />
      <ScrollArea className="gap-3">
        {job && (
          <Card className="rise-1 flex items-center gap-3 px-3.5 py-2.5">
            <Illustration name={vehicle} className="w-16" />
            <div className="flex-1">
              <div className="font-extrabold">{job.reference}</div>
              <div className="text-caption text-mute">
                {jobQuantity(job)} · {TRIP_STEP_LINE[step ?? 'station']}
              </div>
            </div>
          </Card>
        )}
        <SectionTitle className="rise-2">What is wrong?</SectionTitle>
        <div role="radiogroup" aria-label="Problem" className="rise-2 grid grid-cols-2 gap-2.5">
          {(Object.keys(ISSUE_LABEL) as PartnerIssueType[]).map((t) => {
            const on = t === type
            const st = ISSUE_STYLE[t]
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setType(t)}
                className={cx('mo-opt min-h-[84px] items-start p-3 text-left', on && 'border-primary bg-sky shadow-selected')}
              >
                <IconBadge tone={st.tone} size={32} radius={10}>
                  {st.icon}
                </IconBadge>
                <span className="text-[13px] leading-[1.3] font-bold">{ISSUE_LABEL[t](vehicle)}</span>
              </button>
            )
          })}
        </div>
        <TextAreaField
          className="rise-3"
          label="Add a note"
          rows={2}
          placeholder="e.g. Gate locked, customer not answering"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        {opensAttempts && (
          <Notice tone="info">
            <b>You have arrived.</b> Record your attempts to reach the customer on the next screen. The report cannot record them.
          </Notice>
        )}
        {report.isSuccess && <Notice tone="success">Sent. Admin will contact you. If it is urgent, call admin now.</Notice>}
        {report.isError && <Notice tone="error">{errorMessage(report.error)}</Notice>}
      </ScrollArea>
      <Footer>
        {opensAttempts && job ? (
          <ButtonLink to={`${base}/jobs/${job.reference}/unreachable`}>Record attempts</ButtonLink>
        ) : (
          <Button loading={report.isPending} disabled={report.isSuccess} onClick={() => report.mutate({ type, note, reference: job?.reference ?? null })}>
            {report.isSuccess ? 'Sent to admin' : 'Send to admin'}
          </Button>
        )}
        <ButtonLink to="/partner/contact" variant="alt" className="h-[46px]">
          <PhoneIcon size={18} strokeWidth={2.2} />
          Call admin now
        </ButtonLink>
      </Footer>
    </MobileShell>
  )
}

/* ---------- Decline an assigned order (added, decision 13) ---------- */

export function DeclineJob() {
  const { reference = '' } = useParams()
  const navigate = useNavigate()
  const { base, vehicle } = usePartnerApp()
  const job = useJob(reference)
  const decline = useDeclineJob()
  const [reason, setReason] = useState<DeclineReason | null>(null)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  if (job.data && job.data.stage !== 'assigned') return <Navigate to={base} replace />

  function send() {
    if (!reason) return setProblem('Choose a reason. You can only decline an assigned order with a reason.')
    decline.mutate({ ref: reference, reason, note }, { onSuccess: () => navigate(base, { replace: true }) })
  }

  return (
    <MobileShell>
      <TitleBar back={`${base}/assigned/${reference}`} title="Cannot take this order" />
      <ScrollArea className="gap-3">
        {job.isPending && <LoadingBlock lines={1} />}
        {job.data && <JobMiniCard className="rise-1" job={job.data} sub={`${jobQuantity(job.data)} · assigned by admin`} />}
        <SectionTitle className="rise-2">Why can you not take it?</SectionTitle>
        {problem && <Notice tone="error">{problem}</Notice>}
        <div role="radiogroup" aria-label="Reason" className="rise-2 flex flex-col gap-2">
          {(Object.keys(DECLINE_LABEL) as DeclineReason[]).map((r) => {
            const on = r === reason
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setReason(r)
                  setProblem(null)
                }}
                className={cx(
                  'box-border flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-option border-2 border-solid px-3.5 text-left font-bold text-ink',
                  on ? 'border-primary bg-sky' : 'border-line bg-white',
                )}
              >
                <span aria-hidden="true" className={cx('box-border size-[22px] shrink-0 rounded-full bg-white', on ? 'border-[7px] border-solid border-primary' : 'border-2 border-solid border-radio-line')} />
                {DECLINE_LABEL[r](vehicle)}
              </button>
            )
          })}
        </div>
        <TextAreaField className="rise-3" label="Add a note" optional rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        <Notice className="rise-4">The order goes back to admin, who will assign it to someone else.</Notice>
        {decline.isError && <Notice tone="error">{errorMessage(decline.error)}</Notice>}
      </ScrollArea>
      <Footer>
        <Button onClick={send} loading={decline.isPending}>
          Decline order
        </Button>
        <ButtonLink to={`${base}/assigned/${reference}`} variant="alt" className="h-[46px]">
          Keep the order
        </ButtonLink>
      </Footer>
    </MobileShell>
  )
}
