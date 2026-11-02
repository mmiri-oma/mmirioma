import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Illustration } from '../../../../components/brand/Illustration'
import { CheckIcon } from '../../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar } from '../../../../components/layout/MobileShell'
import { ButtonLink } from '../../../../components/ui/Button'
import { Chip } from '../../../../components/ui/Chip'
import { cx } from '../../../../lib/cx'
import { OrderStepHeading } from '../../components/OrderParts'
import { useOrderDraft } from '../../order/orderDraftContext'

/** Choose Keke or Tanker (`c-type`). The selected type has the tick. */
export function DeliveryType() {
  const navigate = useNavigate()
  const { draft, update } = useOrderDraft()
  const type = draft.delivery_type

  function choose(next: 'keke' | 'tanker') {
    update({ delivery_type: next })
    navigate(next === 'keke' ? '/order/keke' : '/order/tanker')
  }

  return (
    <MobileShell>
      <TopBar left={<BackLink to="/home" />} />
      <ScrollArea>
        <OrderStepHeading step={1} title="Choose delivery type" sub="How would you like to receive your water?" />
        <div className="flex flex-col gap-3.5">
          <TypeCard
            className="rise-2"
            selected={type === 'keke'}
            onSelect={() => choose('keke')}
            illustration={<Illustration name="keke" alt="Blue keke loaded with jerrycans" className="animate-drive mx-auto block h-auto w-[230px]" />}
            title="Keke delivery"
            text="25 L or 50 L jerrycans, 12 to 60 cans. Ideal for homes and small offices."
            chips={
              <>
                <Chip>Same day</Chip>
                <Chip>We pour it in</Chip>
              </>
            }
          />
          <TypeCard
            className="rise-3"
            selected={type === 'tanker'}
            onSelect={() => choose('tanker')}
            illustration={
              <Illustration
                name="tanker"
                alt="Waterline water tanker truck"
                className="animate-drive mx-auto mt-1.5 block h-auto w-[240px] [animation-delay:.5s]"
              />
            }
            title="Tanker delivery"
            text="500, 750 or 1,000 gallons (2,000, 3,000 or 4,000 litres) or a custom size. For big tanks, businesses and estates."
            chips={<Chip tone="green">Ground or overhead tank</Chip>}
          />
        </div>
      </ScrollArea>
      <Footer>
        <ButtonLink to={type === 'keke' ? '/order/keke' : '/order/tanker'}>
          Continue with {type === 'keke' ? 'Keke' : 'Tanker'}
        </ButtonLink>
      </Footer>
    </MobileShell>
  )
}

function TypeCard({
  selected,
  onSelect,
  illustration,
  title,
  text,
  chips,
  className,
}: {
  selected: boolean
  onSelect: () => void
  illustration: ReactNode
  title: string
  text: string
  chips: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'relative block w-full cursor-pointer rounded-[22px] border-2 px-4 pt-3.5 pb-[18px] text-left text-ink',
        selected
          ? 'border-primary bg-[linear-gradient(160deg,#EEF6FF_0%,#DCEBFD_100%)] shadow-[0_12px_26px_rgba(21,112,216,0.16)]'
          : 'border-line bg-white hover:border-[#93C5FD]',
        className,
      )}
    >
      {selected ? (
        <span className="absolute top-3.5 right-3.5 flex size-[26px] items-center justify-center rounded-full bg-primary">
          <CheckIcon size={14} strokeWidth={3.2} color="#fff" roundJoin={false} />
        </span>
      ) : (
        <span aria-hidden="true" className="absolute top-3.5 right-3.5 box-border size-6 rounded-full border-2 border-ring-line" />
      )}
      {illustration}
      <span className="mt-2 block text-[20px] font-extrabold">{title}</span>
      <span className="mt-0.5 block text-sub text-slate">{text}</span>
      <span className="mt-2.5 flex gap-2">{chips}</span>
    </button>
  )
}
