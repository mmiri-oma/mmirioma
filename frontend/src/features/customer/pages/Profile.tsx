import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wave } from '../../../components/art/Art'
import {
  AlertCircleIcon,
  CameraBodyIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  PhoneIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from '../../../components/icons/icons'
import { MobileShell, ScrollArea, TopBarSpacer } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Avatar } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { IconBadge, type IconBadgeTone } from '../../../components/ui/Content'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Toggle } from '../../../components/ui/Controls'
import { Notice } from '../../../components/ui/Notice'
import type { CustomerProfile } from '../../../domain/orders'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { formatPhone } from '../../../lib/format/phone'
import { useLogout, useSession } from '../../auth/useSession'
import { PushSettingRows } from '../../pwa/PushParts'
import { useProfile, useUpdateProfile } from '../queries'
import { CUSTOMER_PROFILE_EDITS_ENABLED, POINTS_ENABLED, PUSH_ENABLED } from '../../../lib/features'

/** Largest photo accepted, before it is stored (keeps uploads small on mobile data). */
const MAX_PHOTO_BYTES = 500_000

const PREFS: { key: keyof NonNullable<CustomerProfile['preferences']>; title: string; sub: string }[] = [
  { key: 'sms_updates', title: 'SMS updates', sub: 'Order status and delivery codes' },
  { key: 'whatsapp_updates', title: 'WhatsApp updates', sub: 'Rider arrival and receipts' },
  { key: 'offers_and_news', title: 'Offers and news', sub: 'Promos, now and then' },
]

/** My profile (`c-profile`): name, stats and phone. Settings are on Account settings. */
export function Profile() {
  const profile = useProfile()
  const update = useUpdateProfile()
  // Phone and its status come from the session (`GET /auth/me`), so this card
  // works with the real API even before the rest of the profile is linked.
  const user = useSession().data?.user
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const p = profile.data
  // Until the customer profile endpoint exists (#82), the profile answers
  // `not_connected` with the real API: its own parts stay hidden, with no
  // error box, and the name and account actions come from the session.
  const profileNotLinked = profile.error instanceof ApiError && profile.error.code === 'not_connected'
  const name = p?.name ?? user?.name ?? ''

  function pickPhoto(file: File | undefined) {
    setPhotoError(null)
    if (!file) return
    if (!file.type.startsWith('image/')) return setPhotoError('Choose a photo (JPG or PNG).')
    if (file.size > MAX_PHOTO_BYTES) return setPhotoError('That photo is too large. Choose one under 500 KB.')
    const reader = new FileReader()
    reader.onload = () => update.mutate({ photo_url: String(reader.result) })
    reader.readAsDataURL(file)
  }

  const since = p
    ? new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(p.customer_since))
    : ''

  return (
    <MobileShell>
      <ScrollArea className="gap-0 p-0">
        <div className="relative overflow-hidden bg-[linear-gradient(160deg,#0E4A5A_0%,#11708C_60%,#16A0B8_100%)] px-4 pt-3 pb-14 text-white">
          <div className="relative z-[2] flex items-center justify-between">
            <Link to="/menu" aria-label="Back" className="mo-ib text-white hover:text-white">
              <ChevronLeftIcon size={22} strokeWidth={2.4} roundJoin={false} />
            </Link>
            <h1 className="m-0 text-[17px] font-extrabold">My profile</h1>
            <TopBarSpacer />
          </div>
          {p && (
            <div className="rise-1 relative z-[2] mt-1.5 flex flex-col items-center gap-1.5">
              <span className="relative">
                <Avatar name={p.name} size={78} fontSize={24} photoUrl={p.photo_url} className="shadow-[0_0_0_4px_rgba(255,255,255,0.35)]" />
                {CUSTOMER_PROFILE_EDITS_ENABLED && (
                  <>
                    <button
                      type="button"
                      aria-label="Change photo"
                      onClick={() => fileRef.current?.click()}
                      className="hit-44 absolute right-[-2px] bottom-[-2px] flex size-7 cursor-pointer items-center justify-center rounded-full border-0 bg-gold text-ink"
                    >
                      <CameraBodyIcon size={14} strokeWidth={2.4} />
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(e) => pickPhoto(e.target.files?.[0])}
                    />
                  </>
                )}
              </span>
              <div className="text-[20px] font-extrabold">{p.name}</div>
              <div className="text-[13px] text-[#DCEBFD]">Customer since {since}</div>
            </div>
          )}
          {!p && name && (
            <div className="rise-1 relative z-[2] mt-1.5 flex flex-col items-center gap-1.5">
              <Avatar name={name} size={78} fontSize={24} className="shadow-[0_0_0_4px_rgba(255,255,255,0.35)]" />
              <div className="text-[20px] font-extrabold">{name}</div>
            </div>
          )}
          <Wave fill="#F4F7FB" className="bottom-[-1px]" />
        </div>
        <div className="relative z-[3] mt-[-26px] flex flex-col gap-3 px-gutter pb-5">
          {profile.isPending && <LoadingBlock label="Loading your profile" />}
          {profile.isError && !profileNotLinked && <ErrorBlock error={profile.error} onRetry={() => profile.refetch()} />}
          {photoError && <Notice tone="error">{photoError}</Notice>}
          {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
          {p && (
            <Card className={`rise-2 grid py-3 text-center ${POINTS_ENABLED && p.stats.points !== null ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <Stat value={p.stats.orders} label="Orders" />
              {POINTS_ENABLED && p.stats.points !== null && (
                <div className="border-x border-solid border-hairline">
                  <Stat value={p.stats.points} label="Points" valueClass="text-gold-ink" />
                </div>
              )}
              <Stat value={p.stats.addresses} label="Addresses" />
            </Card>
          )}
          {user && (
            <Card className="rise-3 px-4 py-1">
              <div className="mo-li">
                <span className="flex-1">
                  <span className="block text-chip text-mute">Phone</span>
                  <span className="font-bold">{formatPhone(user.phone)}</span>
                </span>
                {/* Icon and words, never colour alone (phone-verification.md, decision 8). */}
                {user.phone_verified ? (
                  <Chip tone="green" icon={<CheckIcon size={14} strokeWidth={3} />} className="px-2 py-[3px]">
                    Verified
                  </Chip>
                ) : (
                  <Chip tone="amber" icon={<AlertCircleIcon size={14} />} className="px-2 py-[3px]">
                    Not verified yet
                  </Chip>
                )}
              </div>
              {!user.phone_verified && (
                <Link to="/verify-phone" state={{ from: '/profile' }} className="mo-li hover:text-ink">
                  <span className="flex-1">
                    <span className="block font-bold">Verify your phone number</span>
                    <span className="text-chip text-mute">Needed before your first water request.</span>
                  </span>
                  <span className="text-[13px] font-bold text-primary">Verify</span>
                </Link>
              )}
            </Card>
          )}
          <Card className="rise-4 px-4 py-1">
            <SettingLink to="/settings">Account settings</SettingLink>
          </Card>
        </div>
      </ScrollArea>
    </MobileShell>
  )
}

/**
 * Account settings (`/settings`), separate from My profile (owner's decision
 * on #57, 2026-10-27; built from the existing rows, as the partner app's
 * Account settings). Sign-in and security, then the mock-only email and
 * message switches (out of the pilot: customer-account.md decisions 1 and 3),
 * then privacy, account deletion and log out.
 */
export function AccountSettings() {
  const navigate = useNavigate()
  const profile = useProfile()
  const update = useUpdateProfile()
  const logout = useLogout()
  const [leaving, setLeaving] = useState(false)
  const p = profile.data
  return (
    <MobileShell>
      <ScrollArea className="gap-0 p-0">
        {/* The same blue header and wave as My profile. */}
        <div className="relative overflow-hidden bg-[linear-gradient(160deg,#0E4A5A_0%,#11708C_60%,#16A0B8_100%)] px-4 pt-3 pb-14 text-white">
          <div className="relative z-[2] flex items-center justify-between">
            <Link to="/menu" aria-label="Back" className="mo-ib text-white hover:text-white">
              <ChevronLeftIcon size={22} strokeWidth={2.4} roundJoin={false} />
            </Link>
            <h1 className="m-0 text-[17px] font-extrabold">Account settings</h1>
            <TopBarSpacer />
          </div>
          <div className="rise-1 relative z-[2] mt-2.5 flex flex-col items-center gap-1.5 text-center">
            <span className="flex size-[64px] items-center justify-center rounded-full bg-white/20 shadow-[0_0_0_4px_rgba(255,255,255,0.18)]">
              <SettingsIcon size={30} />
            </span>
            <div className="text-[13px] text-[#DCEBFD]">Sign-in, privacy and your account</div>
          </div>
          <Wave fill="#F4F7FB" className="bottom-[-1px]" />
        </div>
        <div className="relative z-[3] mt-[-26px] flex flex-col gap-3 px-gutter pb-5">
          {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
          <Card className="rise-2 px-4 py-1">
            <SettingRow to="/profile/password" tone="blue" icon={<LockIcon size={20} />} title="Change password" sub="You sign in with your phone number and password" />
            <SettingRow to="/profile/phone" tone="green" icon={<PhoneIcon size={20} />} title="Change phone number" sub="We send a code to the new number" />
          </Card>
          {p && (
            <>
              {/* Absent when the app does not offer email (customer-account.md, decision 1). */}
              {p.email !== undefined && (
                <Card className="rise-3 px-4 py-1">
                  <div className="mo-li">
                    <span className="min-w-0 flex-1">
                      <span className="block text-chip text-mute">Email (optional)</span>
                      <span className="block truncate font-bold">{p.email ?? 'Add an email for updates and offers'}</span>
                    </span>
                    <Link to="/profile/email" className="hit-44 text-[13px] font-bold text-primary no-underline hover:text-primary-dark">
                      {p.email ? 'Edit' : 'Add'}
                    </Link>
                  </div>
                </Card>
              )}
              {/* Empty with the real API: no push (#221) and no switches. */}
              {(PUSH_ENABLED || p.preferences) && (
                <Card className="rise-3 px-4 py-1">
                  <PushSettingRows app="customer" />
                  {/* No switches when the app does not offer them (customer-account.md, decision 3). */}
                  {p.preferences && PREFS.map((pref) => (
                    <div key={pref.key} className="mo-li">
                      <span className="flex-1">
                        <span className="block font-bold">{pref.title}</span>
                        <span className="text-chip text-mute">{pref.sub}</span>
                      </span>
                      <Toggle label={pref.title} checked={p.preferences?.[pref.key] ?? false} onChange={(v) => update.mutate({ preferences: { [pref.key]: v } })} />
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}
          <Card className="rise-4 px-4 py-1">
            <SettingRow to="/privacy" tone="violet" icon={<ShieldIcon size={20} />} title="Privacy notice" sub="What we collect and why" />
            <SettingRow to="/profile/delete" tone="red" icon={<UserIcon size={20} />} title="Delete my account" sub="Ask our team to close your account" danger />
          </Card>
          <Button variant="line-danger" className="rise-5" onClick={() => setLeaving(true)}>
            Log out
          </Button>
          <ConfirmDialog
            open={leaving}
            title="Log out of Waterline?"
            confirmLabel="Log out"
            loading={logout.isPending}
            onCancel={() => setLeaving(false)}
            onConfirm={() => logout.mutate(undefined, { onSettled: () => navigate('/signin', { replace: true }) })}
          >
            You will need your phone number and password to sign in again.
          </ConfirmDialog>
        </div>
      </ScrollArea>
    </MobileShell>
  )
}

/** A settings row: coloured icon badge, title and one line of help, then a chevron. */
function SettingRow({
  to,
  tone,
  icon,
  title,
  sub,
  danger = false,
}: {
  to: string
  tone: IconBadgeTone
  icon: ReactNode
  title: string
  sub: string
  danger?: boolean
}) {
  return (
    <Link to={to} className="mo-li gap-3 hover:text-ink">
      <IconBadge tone={tone} size={36} radius={11}>
        {icon}
      </IconBadge>
      <span className="min-w-0 flex-1">
        <span className={`block font-bold ${danger ? 'text-red' : ''}`}>{title}</span>
        <span className="block text-chip text-mute">{sub}</span>
      </span>
      <ChevronRightIcon size={18} strokeWidth={2.2} color="#56677D" roundJoin={false} />
    </Link>
  )
}

function Stat({ value, label, valueClass }: { value: number; label: string; valueClass?: string }) {
  return (
    <div>
      <div className={`text-[20px] font-extrabold ${valueClass ?? ''}`}>{value}</div>
      <div className="text-chip text-mute">{label}</div>
    </div>
  )
}

function SettingLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mo-li font-bold hover:text-ink">
      {children}
      <ChevronRightIcon size={18} strokeWidth={2.2} color="#56677D" roundJoin={false} className="ml-auto" />
    </Link>
  )
}
