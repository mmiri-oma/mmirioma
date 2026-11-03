import type { ReactNode } from 'react'
import { AlertCircleIcon, BellIcon, CheckIcon, CloseIcon, NavigationIcon, PersonSolidIcon, StarIcon, TagIcon } from '../../../components/icons/icons'
import { BackLink, MobileShell, ScrollArea, TopBar, TopBarTitle } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { CardLink } from '../../../components/ui/Card'
import { GroupLabel, IconBadge, type IconBadgeTone } from '../../../components/ui/Content'
import type { CustomerNotification } from '../../../domain/orders'
import { cx } from '../../../lib/cx'
import { formatDate, formatShortDate, formatTime } from '../../../lib/format/datetime'
import { useMarkNotificationsRead, useNotifications } from '../queries'

const KIND: Record<CustomerNotification['kind'], { tone: IconBadgeTone; icon: ReactNode }> = {
  on_the_way: { tone: 'blue', icon: <NavigationIcon size={20} /> },
  rider_assigned: { tone: 'teal', icon: <PersonSolidIcon size={20} /> },
  order_received: { tone: 'green', icon: <CheckIcon size={20} /> },
  delivered: { tone: 'green', icon: <CheckIcon size={20} /> },
  points: { tone: 'gold', icon: <StarIcon size={20} /> },
  payment: { tone: 'violet', icon: <TagIcon size={20} /> },
  // Kinds the server adds (customer-account.md); existing icons, no new ones.
  order_confirmed: { tone: 'green', icon: <CheckIcon size={20} /> },
  cancelled: { tone: 'red', icon: <CloseIcon size={20} /> },
  delivery_failed: { tone: 'red', icon: <AlertCircleIcon size={20} /> },
  update: { tone: 'blue', icon: <BellIcon size={20} /> },
}

/** Where a notification leads, as linked in the design. */
function target(n: CustomerNotification): string {
  if (n.kind === 'points') return '/points'
  if (!n.reference) return '/orders'
  // An ended order, or a message this build does not know: the order's details, not tracking.
  if (n.kind === 'payment' || n.kind === 'cancelled' || n.kind === 'delivery_failed' || n.kind === 'update') return `/orders/${n.reference}`
  if (n.kind === 'delivered') return `/orders/${n.reference}/delivered`
  return `/orders/${n.reference}/track`
}

/** Notifications (`c-notifications`): today first, then earlier. */
export function Notifications() {
  const list = useNotifications()
  const markRead = useMarkNotificationsRead()
  const today = formatDate(new Date())
  const items = list.data?.items ?? []
  const todays = items.filter((n) => formatDate(n.at) === today)
  const earlier = items.filter((n) => formatDate(n.at) !== today)
  // The server's count: unread messages may be older than the page shown.
  const unread = (list.data?.unread_count ?? 0) > 0

  function row(n: CustomerNotification, anim: string) {
    const k = KIND[n.kind]
    return (
      <CardLink
        key={n.id}
        to={target(n)}
        className={cx('flex items-start gap-3 px-3.5 py-3', anim, !n.read && 'border-[#D4ECEF] bg-[#F2F8FF]')}
      >
        <IconBadge tone={k.tone}>{k.icon}</IconBadge>
        <span className="flex flex-1 flex-col">
          <span className="text-[14px] font-extrabold">{n.title}</span>
          <span className="text-[13px] text-slate">{n.body}</span>
          <span className="mt-0.5 text-tab text-mute">{formatDate(n.at) === today ? formatTime(n.at) : formatShortDate(n.at)}</span>
        </span>
        {!n.read && <span role="img" aria-label="Unread" className="glow mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />}
      </CardLink>
    )
  }

  return (
    <MobileShell>
      <TopBar
        left={<BackLink to="/home" />}
        center={<TopBarTitle>Notifications</TopBarTitle>}
        right={
          <button
            type="button"
            disabled={!unread || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
            className="cursor-pointer border-0 bg-transparent px-1 py-2.5 text-[13px] font-bold text-primary disabled:cursor-default disabled:text-mute"
          >
            Mark all read
          </button>
        }
      />
      <ScrollArea className="gap-2.5">
        {list.isPending && <LoadingBlock label="Loading notifications" />}
        {list.isError && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
        {list.isSuccess && items.length === 0 && <EmptyBlock title="No notifications" text="Order updates and offers will show here." />}
        {todays.length > 0 && <GroupLabel className="rise-1">Today</GroupLabel>}
        {todays.map((n) => row(n, 'rise-2'))}
        {earlier.length > 0 && <GroupLabel className="rise-3 mt-1.5">Earlier</GroupLabel>}
        {earlier.map((n) => row(n, 'rise-3'))}
      </ScrollArea>
    </MobileShell>
  )
}
