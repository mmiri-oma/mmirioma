import { useState } from 'react'
import { Illustration } from '../components/brand/Illustration'
import {
  CartIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DocumentLinesIcon,
  DocumentSolidIcon,
  HelpCircleIcon,
  HistoryAltIcon,
  HomeSolidIcon,
  LogOutIcon,
  MapPinIcon,
  NavigationIcon,
  PersonIcon,
  StarIcon,
  TrendUpIcon,
} from '../components/icons/icons'
import { AdminShell } from '../components/layout/AdminShell'
import { BottomTabBar } from '../components/layout/BottomTabBar'
import { DrawerMenu } from '../components/layout/DrawerMenu'
import {
  MenuLink,
  MobileShell,
  NotificationsLink,
  ProfileLink,
  ScrollArea,
  TopBar,
} from '../components/layout/MobileShell'
import { DataTable, MiniButton, StatCard } from '../components/ui/Admin'
import { Avatar } from '../components/ui/Avatar'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip, SampleTag } from '../components/ui/Chip'
import { OptionTile, RadioRow } from '../components/ui/Choice'
import { CodeBoxes, Keypad } from '../components/ui/CodeEntry'
import {
  ActionTile,
  CountBadge,
  GroupLabel,
  IconBadge,
  KeyValue,
  MenuItem,
  ScreenHeading,
  SectionHeader,
  Separator,
  StepBar,
  TextLink,
} from '../components/ui/Content'
import { PageTabs, Pills, Segmented, Toggle } from '../components/ui/Controls'
import { TextField } from '../components/ui/Field'
import { formatNaira } from '../lib/format/money'

/*
 * Development-only gallery of the Phase 2 shared components inside the two
 * layout shells. Reachable at /dev/* in `npm run dev` only; it is not part of
 * the production route table. Sample values are illustration only.
 */

const CUSTOMER_TABS = [
  { to: '/dev/mobile', label: 'Home', icon: (on: boolean) => <HomeSolidIcon size={22} filled={on} /> },
  { to: '/dev/menu', label: 'Order', icon: () => <CartIcon size={22} /> },
  { to: '/dev/admin', label: 'Orders', icon: (on: boolean) => (on ? <DocumentSolidIcon size={22} filled /> : <DocumentLinesIcon size={22} />) },
  { to: '/dev/foundation', label: 'Profile', icon: () => <PersonIcon size={22} roundJoin={false} /> },
]

/** Mobile shell with every shared phone component. */
export function MobileGallery() {
  const [size, setSize] = useState('25')
  const [cans, setCans] = useState('24')
  const [seg, setSeg] = useState('week')
  const [pill, setPill] = useState('all')
  const [sms, setSms] = useState(true)
  const [offers, setOffers] = useState(false)
  const [addr, setAddr] = useState('home')
  const [code, setCode] = useState('4827')
  return (
    <MobileShell>
      <TopBar
        left={<MenuLink to="/dev/menu" />}
        right={
          <div className="flex items-center gap-1">
            <NotificationsLink to="/dev/admin" unread={1} />
            <ProfileLink to="/dev/menu" name="Adaeze Nwosu" />
          </div>
        }
      />
      <ScrollArea>
        <div className="rise-1">
          <StepBar total={4} done={2} className="mb-3.5" />
          <ScreenHeading title="Water size and quantity" sub="Pick a jerrycan size, then how many cans you need." />
        </div>
        <fieldset className="rise-2 m-0 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[14px] font-bold">Jerrycan size</legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['25', '25 litres', 46],
              ['50', '50 litres', 60],
            ].map(([v, l, h]) => (
              <OptionTile key={v} selected={size === v} onSelect={() => setSize(String(v))} className="px-2 pt-4 pb-3">
                <Illustration name="jerrycan" style={{ height: Number(h) }} />
                <span className="text-[16px] font-extrabold">{l}</span>
              </OptionTile>
            ))}
          </div>
        </fieldset>
        <fieldset className="rise-3 m-0 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[14px] font-bold">How many cans?</legend>
          <div className="grid grid-cols-4 gap-2.5">
            {['12', '24', '30', '60'].map((n) => (
              <OptionTile key={n} selected={cans === n} tick={false} onSelect={() => setCans(n)} className="px-1 py-3">
                <span className="text-[19px] font-extrabold">{n}</span>
                <span className="text-tab text-mute">cans</span>
              </OptionTile>
            ))}
          </div>
        </fieldset>
        <Card pad className="rise-4">
          <SectionHeader title="Order summary" action={<SampleTag>SAMPLE PRICES</SampleTag>} className="mb-2" />
          <div className="flex items-center gap-3">
            <Illustration name="keke" className="animate-drive w-[118px] shrink-0" />
            <div className="flex-1">
              <KeyValue label="Water size" value="25 litres" />
              <KeyValue label="Quantity" value="24 cans" />
              <KeyValue label="Total water" value="600 L" />
              <KeyValue label="Price per can" value={formatNaira(25000)} />
              <KeyValue label="Delivery" value={formatNaira(50000)} />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-extrabold">Total</span>
            <span className="text-[22px] font-extrabold text-primary-dark">{formatNaira(650000)}</span>
          </div>
        </Card>

        <GroupLabel>Chips and badges</GroupLabel>
        <div className="flex flex-wrap gap-2">
          <Chip tone="green" icon={<CheckIcon size={12} strokeWidth={3} roundJoin={false} />}>Delivered</Chip>
          <Chip tone="blue">On the way</Chip>
          <Chip tone="amber">Awaiting rider</Chip>
          <Chip tone="red">Cancelled</Chip>
          <Chip tone="violet">Loading</Chip>
          <Chip tone="gray">Unpaid</Chip>
          <Chip tone="gold">★ 250 points</Chip>
          <CountBadge count={2} label="2 unread" />
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          <ActionTile to="/dev/mobile" icon={<IconBadge tone="blue"><HistoryAltIcon size={22} /></IconBadge>} label="Reorder" />
          <ActionTile to="/dev/mobile" icon={<IconBadge tone="green"><MapPinIcon size={22} /></IconBadge>} label="Addresses" />
          <ActionTile to="/dev/mobile" icon={<IconBadge tone="gold"><StarIcon size={22} filled /></IconBadge>} label="250 pts" />
          <ActionTile to="/dev/mobile" icon={<IconBadge tone="violet"><DocumentLinesIcon size={22} /></IconBadge>} label="My orders" />
        </div>

        <GroupLabel>Buttons</GroupLabel>
        <Button>Continue</Button>
        <ButtonLink to="/dev/admin" variant="alt">Back to home</ButtonLink>
        <Button variant="line">Line button</Button>
        <div className="flex gap-2">
          <Button size="sm" block={false}>Small</Button>
          <Button size="sm" block={false} variant="alt">Small alt</Button>
        </div>
        <Button disabled>Verify code</Button>
        <Button loading>Placing order</Button>

        <GroupLabel>Form</GroupLabel>
        <PageTabs
          label="Account"
          tabs={[
            { to: '/dev/mobile', label: 'Sign in', current: true },
            { to: '/dev/menu', label: 'Create account', current: false },
          ]}
        />
        <TextField label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" />
        <TextField label="Landmark" optional defaultValue="Beside Parkview Hotel" />
        <TextField label="Password" type="password" error="Enter at least 8 characters." />
        <Segmented
          label="Period"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
          ]}
        />
        <Pills
          label="Filter orders"
          value={pill}
          onChange={setPill}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'delivered', label: 'Delivered' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <Card pad className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span><b>SMS updates</b><br /><span className="text-caption text-mute">Order status and delivery codes</span></span>
            <Toggle label="SMS updates" checked={sms} onChange={setSms} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span><b>Offers and news</b><br /><span className="text-caption text-mute">Points promos, now and then</span></span>
            <Toggle label="Offers and news" checked={offers} onChange={setOffers} />
          </div>
        </Card>
        <div role="radiogroup" aria-label="Saved addresses" className="flex flex-col gap-2">
          {[
            ['home', 'Home', '12 Lakeview Street, GRA, Enugu'],
            ['office', 'Office', '4 Zik Avenue, Uwani, Enugu'],
          ].map(([v, t, a]) => (
            <RadioRow key={v} checked={addr === v} onSelect={() => setAddr(v)}>
              <span className="flex flex-1 flex-col">
                <span className="font-extrabold">{t}</span>
                <span className="text-chip text-mute">{a}</span>
              </span>
            </RadioRow>
          ))}
        </div>

        <GroupLabel>Delivery code</GroupLabel>
        <CodeBoxes value={code} />
        <div className="flex justify-between text-[13px]">
          <span className="text-mute">Code sent to customer</span>
          <TextLink to="/dev/mobile">Resend in 01:45</TextLink>
        </div>
        <Keypad value={code} onChange={setCode} />
        <CodeBoxes value="482719" invalid />
      </ScrollArea>
      <BottomTabBar label="Main" items={CUSTOMER_TABS} current="/dev/mobile" />
    </MobileShell>
  )
}

/** Drawer menu demo (customer menu layout). */
export function MenuGallery() {
  return (
    <DrawerMenu
      closeTo="/dev/mobile"
      label="Account menu"
      header={
        <div className="relative flex items-center gap-3">
          <Avatar name="Adaeze Nwosu" size={56} fontSize={18} />
          <div>
            <div className="text-[17px] font-extrabold">Adaeze Nwosu</div>
            <div className="text-caption text-slate">0803 123 4567</div>
            <Chip tone="gold" className="mt-1.5 px-[9px] py-[3px]">★ 250 points</Chip>
          </div>
        </div>
      }
      footer={
        <MenuItem
          to="/dev/mobile"
          icon={<LogOutIcon size={20} className="text-red" />}
          className="min-h-[58px] border-t border-hairline font-extrabold !text-red"
        >
          Log out
        </MenuItem>
      }
    >
      <MenuItem to="/dev/mobile" current icon={<HomeSolidIcon size={20} filled />}>Home</MenuItem>
      <MenuItem to="/dev/mobile" icon={<PersonIcon size={20} roundJoin={false} />}>My profile</MenuItem>
      <MenuItem to="/dev/mobile" icon={<DocumentLinesIcon size={20} />} trailing={<Chip className="px-2 py-0.5">1 active</Chip>}>
        My orders
      </MenuItem>
      <MenuItem to="/dev/mobile" icon={<HelpCircleIcon size={20} roundJoin={false} />} trailing={<CountBadge count={2} />}>
        Support
      </MenuItem>
      <MenuItem to="/dev/mobile" icon={<CloseIcon size={20} roundJoin={false} />}>Close</MenuItem>
    </DrawerMenu>
  )
}

interface DemoOrder {
  ref: string
  customer: string
  type: 'Keke' | 'Tanker'
  qty: string
  amountKobo: number
  status: { label: string; tone: 'amber' | 'violet' | 'blue' | 'green' }
}

const ORDERS: DemoOrder[] = [
  { ref: 'MO-3HT8WQ2KZP', customer: 'Ifeoma Eze', type: 'Keke', qty: '50 L × 12', amountKobo: 590000, status: { label: 'Awaiting rider', tone: 'amber' } },
  { ref: 'MO-5KL2ZT8QWD', customer: 'Chukwudi Ilonze', type: 'Tanker', qty: '750 gal', amountKobo: 2700000, status: { label: 'Loading', tone: 'violet' } },
  { ref: 'MO-7KQ2M9XH4T', customer: 'Adaeze Nwosu', type: 'Keke', qty: '25 L × 24', amountKobo: 650000, status: { label: 'On the way', tone: 'blue' } },
]

/** Admin shell with stat cards and the table pattern. */
export function AdminGallery() {
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(ORDERS[0].ref)
  return (
    <AdminShell
      searchPlaceholder="Search orders, customers, riders, stations"
      user={{ name: 'Chidimma M.', role: 'Super admin' }}
      counts={{ orders: 12, support: 3 }}
      unread={12}
    >
      <div className="rise-1 flex flex-wrap items-end justify-between gap-3">
        <ScreenHeading title="Good morning, Chidimma" sub="Here is what is happening on Waterline today." titleClassName="text-admin-title" />
        <div className="flex items-center gap-2.5">
          <SampleTag>SAMPLE DATA</SampleTag>
          <ButtonLink to="/dev/admin" size="sm" block={false}>+ Create order</ButtonLink>
        </div>
      </div>
      <div className="rise-2 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
        <StatCard tone="blue" icon={<DocumentLinesIcon size={24} />} value="120" label="Total orders" note="▲ 12% vs yesterday" noteTone="green" />
        <StatCard tone="gold" icon={<ClockIcon size={24} />} value="12" label="Awaiting rider" note="Oldest 18 min" valueClassName="text-[#B45309]" />
        <StatCard tone="teal" icon={<NavigationIcon size={24} />} value="30" label="In progress" note="▲ 8% vs yesterday" noteTone="green" />
        <StatCard tone="green" icon={<TrendUpIcon size={24} strokeWidth={2.2} roundJoin={false} />} value={formatNaira(48600000)} label="Revenue today" note="▲ 18% vs yesterday" noteTone="green" />
      </div>
      <Pills
        label="Filter orders"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All (120)' },
          { value: 'awaiting', label: 'Awaiting rider (12)' },
          { value: 'progress', label: 'In progress (30)' },
        ]}
      />
      <Card className="rise-3 overflow-x-auto px-1 py-1.5">
        <DataTable
          caption="Recent orders"
          rows={ORDERS}
          rowKey={(o) => o.ref}
          selectedKey={selected}
          columns={[
            {
              header: 'Order',
              cell: (o) => (
                <button type="button" onClick={() => setSelected(o.ref)} className="cursor-pointer border-0 bg-transparent p-0 font-extrabold text-primary-dark">
                  {o.ref}
                </button>
              ),
            },
            { header: 'Customer', cell: (o) => o.customer },
            { header: 'Type', cell: (o) => o.type, className: 'font-bold' },
            { header: 'Quantity', cell: (o) => o.qty },
            { header: 'Amount', cell: (o) => formatNaira(o.amountKobo) },
            { header: 'Status', cell: (o) => <Chip tone={o.status.tone}>{o.status.label}</Chip> },
            { header: 'Action', cell: (o) => <MiniButton tone={o.status.tone === 'amber' ? 'primary' : 'alt'}>{o.status.tone === 'amber' ? 'Assign' : 'View'}</MiniButton> },
          ]}
        />
      </Card>
      <p className="m-0 text-caption text-mute">Payment status and delivery status are tracked separately. Sample data.</p>
    </AdminShell>
  )
}
