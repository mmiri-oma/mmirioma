import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Illustration } from '../../../components/brand/Illustration'
import {
  DocumentLinesIcon,
  HelpCircleIcon,
  HomeSolidIcon,
  LogOutIcon,
  MapPinIcon,
  PersonIcon,
  StarIcon,
  SunIcon,
  BellIcon,
  VehicleSmallIcon,
} from '../../../components/icons/icons'
import { DrawerMenu } from '../../../components/layout/DrawerMenu'
import { Avatar } from '../../../components/ui/Avatar'
import { Chip } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { CountBadge, MenuItem } from '../../../components/ui/Content'
import { isActiveStage } from '../../../domain/orders'
import { formatPhone } from '../../../lib/format/phone'
import { useLogout, useSession } from '../../auth/useSession'
import { InstallMenuItem } from '../../pwa/InstallParts'
import { POINTS_ENABLED } from '../../../lib/features'
import { useNotifications, useOrders, usePoints, useProfile } from '../queries'

/** Customer account menu (`c-menu`). */
export function Menu() {
  const navigate = useNavigate()
  const logout = useLogout()
  const [leaving, setLeaving] = useState(false)
  const profile = useProfile()
  // Name and phone also come with the session (`GET /auth/me`), so the header
  // works before the customer profile endpoint exists (#82).
  const user = useSession().data?.user
  const name = profile.data?.name ?? user?.name ?? ''
  const phone = profile.data?.phone ?? user?.phone
  const orders = useOrders()
  const points = usePoints()
  const notifications = useNotifications()

  const active = orders.data?.filter((o) => isActiveStage(o.stage)).length ?? 0
  const unread = notifications.data?.unread_count ?? 0
  const toNext = points.data ? Math.max(0, points.data.next_reward.target - points.data.balance) : null

  return (
    <DrawerMenu
      closeTo="/home"
      label="Account menu"
      header={
        <>
          <Illustration name="drop-hero" className="absolute top-[-10px] right-[-70px] h-[150px] w-auto max-w-none opacity-45" />
          <div className="relative flex items-center gap-3">
            <Avatar name={name} size={56} fontSize={18} />
            <div>
              <div className="text-[17px] font-extrabold">{name}</div>
              <div className="text-caption text-slate">{phone && formatPhone(phone)}</div>
              {points.data && (
                <Chip tone="gold" className="mt-1.5 px-[9px] py-[3px]">
                  ★ {points.data.balance} points
                </Chip>
              )}
            </div>
          </div>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => setLeaving(true)}
            className="flex min-h-[58px] cursor-pointer items-center gap-3.5 border-0 border-t border-solid border-hairline bg-transparent px-5 text-left text-[15px] font-extrabold text-red transition-colors duration-150 hover:bg-red-bg"
          >
            <LogOutIcon size={20} className="text-red" />
            Log out
          </button>
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
        </>
      }
    >
      <MenuItem to="/home" current icon={<HomeSolidIcon size={20} filled />}>
        Home
      </MenuItem>
      <MenuItem to="/profile" icon={<PersonIcon size={20} roundJoin={false} />}>
        My profile
      </MenuItem>
      <MenuItem
        to="/orders"
        icon={<DocumentLinesIcon size={20} />}
        trailing={active > 0 ? <Chip className="px-2 py-0.5">{active} active</Chip> : undefined}
      >
        My orders
      </MenuItem>
      <MenuItem to="/addresses" icon={<MapPinIcon size={20} />}>
        Saved addresses
      </MenuItem>
      {POINTS_ENABLED && (
        <MenuItem to="/points" icon={<StarIcon size={20} />}>
          My points
        </MenuItem>
      )}
      <MenuItem
        to="/notifications"
        icon={<BellIcon size={20} />}
        trailing={unread > 0 ? <CountBadge count={unread} label={`${unread} unread`} /> : undefined}
      >
        Notifications
      </MenuItem>
      <MenuItem to="/support" icon={<HelpCircleIcon size={20} roundJoin={false} />}>
        Support
      </MenuItem>
      <MenuItem to="/settings" icon={<SunIcon size={20} roundJoin={false} />}>
        Account settings
      </MenuItem>
      <InstallMenuItem app="customer" />
      <MenuItem to="/partner/signup" icon={<VehicleSmallIcon size={20} />}>
        Register as a driver
      </MenuItem>
      {toNext !== null && (
        <div className="mx-4 mt-3.5 flex items-center gap-2.5 rounded-option bg-[linear-gradient(120deg,#FFF7E2,#FFE9B8)] p-3">
          <Illustration name="gift" className="animate-float w-16" />
          <div className="text-caption text-[#5A4310]">
            <b className="text-ink">{toNext} points to go</b>
            <br />
            until your next {points.data?.next_reward.label}.
          </div>
        </div>
      )}
    </DrawerMenu>
  )
}
