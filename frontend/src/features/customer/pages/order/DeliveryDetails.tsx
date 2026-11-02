import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { DetailsMapArt, MapFrame, MapPin } from '../../../../components/art/Art'
import { ChevronDownIcon } from '../../../../components/icons/icons'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar } from '../../../../components/layout/MobileShell'
import { ErrorBlock } from '../../../../components/layout/StateScreens'
import { Button } from '../../../../components/ui/Button'
import { INPUT, TextField } from '../../../../components/ui/Field'
import { Notice } from '../../../../components/ui/Notice'
import { cx } from '../../../../lib/cx'
import { formatPhone } from '../../../../lib/format/phone'
import { phoneField } from '../../../../lib/forms'
import { UseMyLocation } from '../../../../components/ui/UseMyLocation'
import { AreaPicker } from '../../components/AreaPicker'
import { areaForPlaces } from '../../order/locationArea'
import { OrderStepHeading } from '../../components/OrderParts'
import type { AreaChoice } from '../../order/livePrice'
import { useOrderDraft } from '../../order/orderDraftContext'
import { useAddresses, useProfile, useServiceZones } from '../../queries'

const NEW = 'new'

const schema = z
  .object({
    receiver_name: z.string().trim().min(1, "Enter the receiver's name.").max(100, 'Use 100 characters or fewer.'),
    receiver_phone: phoneField,
    address_id: z.string(),
    address: z.string().trim().max(500, 'Use 500 characters or fewer.'),
    landmark: z.string().trim().max(200, 'Use 200 characters or fewer.'),
    instructions: z.string().trim().max(500, 'Use 500 characters or fewer.'),
  })
  .refine((v) => v.address_id !== NEW || v.address.length >= 5, {
    path: ['address'],
    message: 'Enter the full address, with street and area.',
  })
type Values = z.infer<typeof schema>

/**
 * Delivery details (`c-details`): receiver, address, area, landmark,
 * instructions. The area picker (customer-live-prices.md, screen 2) shows for
 * a new address; a saved address keeps its own area.
 */
export function DeliveryDetails() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { draft, update } = useOrderDraft()
  const profile = useProfile()
  const addresses = useAddresses()
  const [pinNote, setPinNote] = useState(false)
  const selectId = useId()

  const saved = addresses.data ?? []
  const wantsNew = params.get('new') === '1'
  const initialAddressId = wantsNew ? NEW : (draft.address_id ?? saved.find((a) => a.is_default)?.id ?? saved[0]?.id ?? NEW)

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      receiver_name: draft.receiver_name,
      receiver_phone: draft.receiver_phone,
      address_id: initialAddressId,
      address: draft.new_address.address,
      landmark: draft.address_id ? (saved.find((a) => a.id === draft.address_id)?.landmark ?? '') : draft.new_address.landmark,
      instructions: draft.instructions,
    },
  })

  // Fill the receiver with the account holder ("We filled in what we know") once
  // the profile and addresses arrive, without overwriting anything typed.
  useEffect(() => {
    if (profile.data) {
      if (!getValues('receiver_name')) setValue('receiver_name', profile.data.name)
      if (!getValues('receiver_phone')) setValue('receiver_phone', formatPhone(profile.data.phone))
    }
  }, [profile.data, getValues, setValue])

  useEffect(() => {
    if (!addresses.data) return
    const current = getValues('address_id')
    // A draft id that is not one of this account's addresses (left by another
    // account, or a deleted address) is not trusted: fall back as if there were none (#272).
    const staleId = current !== NEW && !addresses.data.some((a) => a.id === current)
    if (staleId) {
      const def = wantsNew ? undefined : (addresses.data.find((a) => a.is_default) ?? addresses.data[0])
      setValue('address_id', def?.id ?? NEW)
      setValue('landmark', def ? (def.landmark ?? '') : draft.new_address.landmark)
    } else if (current === NEW && !wantsNew && !draft.address_id && addresses.data.length > 0) {
      const def = addresses.data.find((a) => a.is_default) ?? addresses.data[0]
      setValue('address_id', def.id)
      setValue('landmark', def.landmark ?? '')
    }
  }, [addresses.data, getValues, setValue, wantsNew, draft.address_id, draft.new_address.landmark])

  const addressId = useWatch({ control, name: 'address_id' })
  const isNew = addressId === NEW
  // A new address needs its area for the price (FR-020); a saved one has its own.
  const [area, setArea] = useState<AreaChoice>(draft.new_address.zone)
  const [areaError, setAreaError] = useState<string | undefined>()
  const zones = useServiceZones()
  const areasReady = !isNew || zones.isSuccess

  const onSubmit = handleSubmit((v) => {
    if (isNew && area === null) {
      setAreaError('Choose your area, or "My area is not listed".')
      return
    }
    update((d) => ({
      receiver_name: v.receiver_name,
      receiver_phone: v.receiver_phone,
      instructions: v.instructions,
      address_id: isNew ? null : v.address_id,
      new_address: isNew ? { ...d.new_address, address: v.address, landmark: v.landmark, zone: area } : d.new_address,
    }))
    navigate(isNew ? '/order/save-address' : '/order/review')
  })

  return (
    <MobileShell>
      <TopBar left={<BackLink to={draft.delivery_type === 'keke' ? '/order/keke' : '/order/tanker'} />} />
      <ScrollArea className="gap-3">
        <OrderStepHeading step={3} title="Delivery details" sub="We filled in what we know. Check it before you continue." />
        {addresses.isError && <ErrorBlock error={addresses.error} onRetry={() => addresses.refetch()} />}
        <form id="details-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <div className="rise-2 grid grid-cols-2 gap-2.5">
            <TextField label="Receiver's name" autoComplete="name" error={errors.receiver_name?.message} {...register('receiver_name')} />
            <TextField
              label="Phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              error={errors.receiver_phone?.message}
              {...register('receiver_phone')}
            />
          </div>
          <div className="rise-3">
            {saved.length > 0 ? (
              <>
                <label htmlFor={selectId} className="mb-1.5 block text-label font-bold">
                  Delivery address
                </label>
                <div className="relative">
                  <select
                    id={selectId}
                    className={cx(INPUT, 'appearance-none pr-10 font-semibold')}
                    {...register('address_id', {
                      onChange: (e) => {
                        const a = saved.find((x) => x.id === e.target.value)
                        setValue('landmark', a?.landmark ?? draft.new_address.landmark)
                      },
                    })}
                  >
                    {saved.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} · {a.address}
                      </option>
                    ))}
                    <option value={NEW}>Add a new address</option>
                  </select>
                  <ChevronDownIcon
                    size={18}
                    strokeWidth={2.2}
                    color="#56677D"
                    roundJoin={false}
                    className="pointer-events-none absolute top-[15px] right-3.5"
                  />
                </div>
              </>
            ) : (
              <input type="hidden" {...register('address_id')} />
            )}
            {isNew && (
              <TextField
                className={saved.length > 0 ? 'mt-2.5' : undefined}
                label={saved.length > 0 ? 'New address' : 'Delivery address'}
                autoComplete="street-address"
                placeholder="e.g. 12 Lakeview Street, GRA, Enugu"
                error={errors.address?.message}
                {...register('address')}
              />
            )}
            {isNew && (
              <UseMyLocation
                place="order_details"
                actionLabel="Use this address"
                className="mt-2.5"
                onFound={(location) => {
                  setValue('address', location.address, { shouldValidate: true, shouldDirty: true })
                  const found = areaForPlaces(zones.data ?? [], location.placeNames)
                  if (found) {
                    setArea(found)
                    setAreaError(undefined)
                  }
                }}
              />
            )}
          </div>
          {isNew && (
            <AreaPicker
              className="rise-3 m-0 border-0 p-0"
              value={area}
              onChange={(choice) => {
                setArea(choice)
                setAreaError(undefined)
              }}
              error={areaError}
              notListedNote={
                <>
                  <b>We can't price this address in the app.</b> You can still send a request, and our team will call you with a price.
                </>
              }
            />
          )}
          <MapFrame height={132} className="rise-3">
            <DetailsMapArt />
            <MapPin color="#1570D8" ringColor="rgba(21,112,216,.35)" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[88%]" />
            <button
              type="button"
              onClick={() => setPinNote((v) => !v)}
              aria-expanded={pinNote}
              className="hit-44 absolute right-2.5 bottom-2.5 cursor-pointer rounded-badge border-0 bg-white px-[11px] py-[7px] text-caption font-bold text-primary shadow-control"
            >
              Move pin
            </button>
          </MapFrame>
          {pinNote && (
            <Notice tone="info">
              Map pins are not available yet. Use the landmark and instructions so the rider can find you.
            </Notice>
          )}
          <TextField className="rise-4" label="Landmark" optional {...register('landmark')} error={errors.landmark?.message} />
          <TextField
            className="rise-5"
            label="Delivery instructions"
            optional
            placeholder="e.g. Call when you reach the gate"
            error={errors.instructions?.message}
            {...register('instructions')}
          />
        </form>
      </ScrollArea>
      <Footer>
        <Button type="submit" form="details-form" disabled={!areasReady}>
          Continue
        </Button>
      </Footer>
    </MobileShell>
  )
}
