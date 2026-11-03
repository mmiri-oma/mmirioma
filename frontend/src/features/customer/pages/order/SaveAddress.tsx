import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { MapPinIcon } from '../../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar } from '../../../../components/layout/MobileShell'
import { Button } from '../../../../components/ui/Button'
import { Card } from '../../../../components/ui/Card'
import { RadioDot } from '../../../../components/ui/Choice'
import { IconBadge, ScreenHeading } from '../../../../components/ui/Content'
import { TextField } from '../../../../components/ui/Field'
import { Notice } from '../../../../components/ui/Notice'
import { errorMessage } from '../../../../lib/api/errorMessage'
import { cx } from '../../../../lib/cx'
import type { SaveMode } from '../../order/draft'
import { useOrderDraft } from '../../order/orderDraftContext'
import { useAddAddress, useAddresses } from '../../queries'

const NAME_CHOICES = ['Home', 'Office', "Mum's House", 'Shop']
const OTHER = '__other__'

/**
 * "Save this address?" after a new address (`c-save`). Saving here means the
 * address is in the address book even if the order is not placed; the
 * customer can remove it from Saved addresses.
 */
export function SaveAddress() {
  const navigate = useNavigate()
  const { draft, update } = useOrderDraft()
  const addresses = useAddresses()
  const add = useAddAddress()
  const existing = addresses.data ?? []
  const current = existing.find((a) => a.is_default)
  const names = NAME_CHOICES.filter((n) => !existing.some((a) => a.label.toLowerCase() === n.toLowerCase()))

  const [mode, setMode] = useState<SaveMode>(draft.new_address.save)
  const [name, setName] = useState<string>(() => {
    const l = draft.new_address.label
    if (!l) return names[0] ?? OTHER
    return names.includes(l) ? l : OTHER
  })
  const [other, setOther] = useState(names.includes(draft.new_address.label) ? '' : draft.new_address.label)
  const [nameError, setNameError] = useState<string | null>(null)

  const zone = draft.new_address.zone
  if (!draft.new_address.address || zone === null) return <Navigate to="/order/details" replace />
  // An address is saved only with an area (FR-020): "not listed" can only be used for this order.
  const notListed = zone === 'not_listed'
  const zoneId = notListed ? null : zone.id

  const label = name === OTHER ? other.trim() : name
  const options: { value: SaveMode; title: string; sub: string }[] = [
    {
      value: 'default',
      title: 'Set as my main address',
      sub: current ? `Replaces ${current.label} as your default` : 'We will pick it first next time',
    },
    { value: 'another', title: 'Save as another address', sub: current ? `${current.label} stays your default` : 'Saved to your addresses' },
    { value: 'once', title: 'Use for this order only', sub: 'We will not save it' },
  ]

  function onContinue() {
    if (mode === 'once' || zoneId === null) {
      update((d) => ({ address_id: null, new_address: { ...d.new_address, save: 'once', label: label || 'Delivery address' } }))
      navigate('/order/review')
      return
    }
    if (label.length < 1 || label.length > 40) {
      setNameError('Give the address a short name, like Home or Shop.')
      return
    }
    add.mutate(
      { label, address: draft.new_address.address, landmark: draft.new_address.landmark || null, zone_id: zoneId, make_default: mode === 'default' },
      {
        onSuccess: (saved) => {
          update((d) => ({ address_id: saved.id, new_address: { ...d.new_address, save: mode, label } }))
          navigate('/order/review')
        },
      },
    )
  }

  return (
    <MobileShell>
      <TopBar left={<BackLink to="/order/details" />} />
      <ScrollArea>
        <ScreenHeading className="rise-1" title="Save this address?" sub="You entered a new address. How should we keep it?" />
        <Card className="rise-2 flex items-center gap-3 px-3.5 py-3">
          <IconBadge tone="blue">
            <MapPinIcon size={20} />
          </IconBadge>
          <span className="flex flex-col">
            <span className="font-extrabold">{draft.new_address.address}</span>
            {draft.new_address.landmark && <span className="text-caption text-mute">Landmark: {draft.new_address.landmark}</span>}
            <span className={cx('text-caption font-bold', notListed ? 'text-[#92400E]' : 'text-primary-dark')}>
              Area: {zone === 'not_listed' ? 'not listed' : zone.name}
            </span>
          </span>
        </Card>
        {notListed ? (
          <Notice className="rise-3">
            <b>This address can't be saved yet,</b> because it is outside the areas we serve. Your order still goes through as a request.
          </Notice>
        ) : (
          <>
            <div role="radiogroup" aria-label="Save address" className="rise-3 flex flex-col gap-2.5">
              {options.map((o) => {
                const on = mode === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMode(o.value)}
                    className={cx(
                      'box-border flex w-full cursor-pointer items-center gap-3 rounded-option border-2 p-3.5 text-ink transition-[background-color,border-color,box-shadow] duration-200',
                      on ? 'border-primary bg-sky shadow-[0_8px_18px_rgba(17,112,140,0.14)]' : 'border-line bg-white',
                    )}
                  >
                    <RadioDot on={on} />
                    <span className="flex flex-1 flex-col text-left">
                      <span className="text-[15px] font-extrabold">{o.title}</span>
                      <span className="text-caption text-mute">{o.sub}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {mode !== 'once' && (
              <div className="rise-1">
                <span id="name-label" className="mb-1.5 block text-label font-bold">
                  Give it a name
                </span>
                <div role="radiogroup" aria-labelledby="name-label" className="flex flex-wrap gap-2">
                  {[...names, OTHER].map((n) => {
                    const on = name === n
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setName(n)
                          setNameError(null)
                        }}
                        className={cx(
                          'hit-44 inline-flex cursor-pointer items-center rounded-chip px-3.5 py-[9px] text-[13px] font-bold whitespace-nowrap',
                          on ? 'border-[1.5px] border-solid border-primary bg-sky text-primary-dark' : 'border-[1.5px] border-solid border-transparent bg-gray-bg text-gray',
                        )}
                      >
                        {n === OTHER ? '+ Other' : n}
                      </button>
                    )
                  })}
                </div>
                {name === OTHER && (
                  <TextField
                    className="mt-2.5"
                    label="Name"
                    placeholder="e.g. Church, Salon"
                    value={other}
                    maxLength={40}
                    onChange={(e) => {
                      setOther(e.target.value)
                      setNameError(null)
                    }}
                    error={nameError ?? undefined}
                  />
                )}
                {nameError && name !== OTHER && <p role="alert" className="mt-1.5 mb-0 text-caption font-bold text-red">{nameError}</p>}
              </div>
            )}
            {add.isError && <Notice tone="error">{errorMessage(add.error)}</Notice>}
            <Notice className="rise-4">You can edit or remove saved addresses any time from your account.</Notice>
          </>
        )}
      </ScrollArea>
      <Footer>
        <Button onClick={onContinue} loading={add.isPending}>
          {notListed ? 'Continue without saving' : 'Continue'}
        </Button>
      </Footer>
    </MobileShell>
  )
}
