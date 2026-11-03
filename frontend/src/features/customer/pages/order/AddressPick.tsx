import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AddressMapArt, MapBadge, MapFrame, MapPin } from '../../../../components/art/Art'
import { PlusIcon } from '../../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar } from '../../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../../components/layout/StateScreens'
import { Button } from '../../../../components/ui/Button'
import { Chip } from '../../../../components/ui/Chip'
import { RadioDot } from '../../../../components/ui/Choice'
import { cx } from '../../../../lib/cx'
import { AddressIcon } from '../../components/AddressIcon'
import { AddressArea } from '../../components/AreaPicker'
import { OrderStepHeading } from '../../components/OrderParts'
import { useOrderDraft } from '../../order/orderDraftContext'
import { useAddresses } from '../../queries'

/** Choose a saved address, for returning customers (`c-address-pick`), each with its area (customer-live-prices.md, screen 3). */
export function AddressPick() {
  const navigate = useNavigate()
  const { draft, update } = useOrderDraft()
  const addresses = useAddresses()
  const list = addresses.data ?? []
  const [picked, setPicked] = useState<string | null>(draft.address_id)
  const selected = list.find((a) => a.id === picked) ?? list.find((a) => a.is_default) ?? list[0]

  function deliverHere() {
    if (!selected) return
    update({ address_id: selected.id })
    navigate('/order/review')
  }

  return (
    <MobileShell>
      <TopBar left={<BackLink to={draft.delivery_type === 'keke' ? '/order/keke' : '/order/tanker'} />} />
      <ScrollArea className="gap-3">
        <OrderStepHeading step={3} title="Where should we deliver?" sub="Pick one of your saved addresses." />
        {addresses.isPending && <LoadingBlock label="Loading your addresses" />}
        {addresses.isError && <ErrorBlock error={addresses.error} onRetry={() => addresses.refetch()} />}
        {list.length > 0 && (
          <div role="radiogroup" aria-label="Saved addresses" className="rise-2 flex flex-col gap-2.5">
            {list.map((a) => {
              const on = a.id === selected?.id
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPicked(a.id)}
                  className={cx(
                    'box-border flex w-full cursor-pointer items-center gap-3 rounded-stat border-2 px-3.5 py-3 text-ink transition-[background-color,border-color,box-shadow] duration-200',
                    on ? 'border-primary bg-sky shadow-[0_8px_18px_rgba(17,112,140,0.14)]' : 'border-line bg-white',
                  )}
                >
                  <AddressIcon label={a.label} />
                  <span className="flex flex-1 flex-col text-left">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-extrabold">{a.label}</span>
                      {a.is_default && <Chip className="px-2 py-0.5 text-[11px]">Default</Chip>}
                    </span>
                    <span className="text-[13px] text-mute">{a.address}</span>
                    {/* Still selectable when no longer served: Review then offers "Send request" (decision 2). */}
                    <AddressArea zone={a.zone} />
                  </span>
                  <RadioDot on={on} />
                </button>
              )
            })}
          </div>
        )}
        <Link
          to="/order/details?new=1"
          className="rise-3 flex min-h-14 items-center justify-center gap-2 rounded-option border-2 border-dashed border-blink bg-[#F4F9FF] font-extrabold text-primary no-underline hover:text-primary"
        >
          <PlusIcon size={18} strokeWidth={2.6} roundJoin={false} />
          Add a new address
        </Link>
        <MapFrame height={150} className="rise-4">
          <AddressMapArt />
          <MapPin color="#11708C" ringColor="rgba(17,112,140,.35)" width={32} height={40} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[88%]" />
          {selected && (
            <MapBadge tone="light" className="bottom-2.5 left-2.5">
              {selected.label} · {selected.address.split(',')[0]}
            </MapBadge>
          )}
        </MapFrame>
      </ScrollArea>
      <Footer>
        <Button onClick={deliverHere} disabled={!selected}>
          Deliver here
        </Button>
      </Footer>
    </MobileShell>
  )
}
