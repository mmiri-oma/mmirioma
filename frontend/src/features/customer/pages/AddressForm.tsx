import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { DetailsMapArt, MapFrame, MapPin } from '../../../components/art/Art'
import { BackLink, Footer, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Toggle } from '../../../components/ui/Controls'
import { TextField } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { errorMessage } from '../../../lib/api/errorMessage'
import { applyServerFieldErrors } from '../../../lib/forms'
import type { SavedAddress } from '../../../domain/orders'
import { UseMyLocation } from '../../../components/ui/UseMyLocation'
import { AreaPicker } from '../components/AreaPicker'
import type { AreaChoice } from '../order/livePrice'
import { areaForPlaces } from '../order/locationArea'
import { useAddAddress, useAddresses, useServiceZones, useUpdateAddress } from '../queries'

const schema = z.object({
  label: z.string().trim().min(1, 'Give the address a name, like Home.').max(40, 'Use 40 characters or fewer.'),
  address: z.string().trim().min(5, 'Enter the full address, with street and area.').max(500, 'Use 500 characters or fewer.'),
  landmark: z.string().trim().max(200, 'Use 200 characters or fewer.'),
  make_default: z.boolean(),
})
type Values = z.infer<typeof schema>

/**
 * Add or edit a saved address. Not a separate screen in the handoff (its
 * "Edit" links open `c-details`); built from the same fields so editing does
 * not start an order, the area picker included (customer-live-prices.md).
 */
export function AddressForm() {
  const { id } = useParams()
  const addresses = useAddresses()
  if (id && addresses.isPending) {
    return (
      <Shell title="Edit address">
        <LoadingBlock />
      </Shell>
    )
  }
  if (id && addresses.isError) {
    return (
      <Shell title="Edit address">
        <ErrorBlock error={addresses.error} onRetry={() => addresses.refetch()} />
      </Shell>
    )
  }
  const existing = id ? addresses.data?.find((a) => a.id === id) : undefined
  if (id && !existing) return <Navigate to="/addresses" replace />
  return <AddressFormBody key={id ?? 'new'} existing={existing} isFirst={(addresses.data?.length ?? 0) === 0} />
}

function Shell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <MobileShell>
      <TopBar left={<BackLink to="/addresses" />} center={<TopBarTitle>{title}</TopBarTitle>} right={<TopBarSpacer />} />
      <ScrollArea className="gap-3">{children}</ScrollArea>
      {footer}
    </MobileShell>
  )
}

function AddressFormBody({ existing, isFirst }: { existing?: SavedAddress; isFirst: boolean }) {
  const navigate = useNavigate()
  const add = useAddAddress()
  const update = useUpdateAddress()
  const mutation = existing ? update : add
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: existing?.label ?? '',
      address: existing?.address ?? '',
      landmark: existing?.landmark ?? '',
      make_default: existing?.is_default ?? isFirst,
    },
  })
  const makeDefault = useWatch({ control, name: 'make_default' })
  // An address is saved only with an area (FR-020). A no-longer-served area must be picked again.
  const [area, setArea] = useState<AreaChoice>(existing?.zone?.is_active ? { id: existing.zone.id, name: existing.zone.name } : null)
  const [areaError, setAreaError] = useState<string | undefined>()
  const zones = useServiceZones()

  const onSubmit = handleSubmit((v) => {
    if (area === null || area === 'not_listed') {
      setAreaError(area === null ? 'Choose the area of this address.' : undefined)
      return
    }
    const input = { label: v.label, address: v.address, landmark: v.landmark || null, zone_id: area.id, make_default: v.make_default }
    const options = {
      onSuccess: () => navigate('/addresses'),
      onError: (e: unknown) => applyServerFieldErrors(e, setError, { label: 'label', address: 'address' }),
    }
    if (existing) update.mutate({ id: existing.id, input }, options)
    else add.mutate(input, options)
  })

  return (
    <Shell
      title={existing ? 'Edit address' : 'New address'}
      footer={
        <Footer>
          <Button type="submit" form="address-form" loading={mutation.isPending} disabled={area === 'not_listed'}>
            Save address
          </Button>
        </Footer>
      }
    >
      <form id="address-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <TextField className="rise-1" label="Name" placeholder="e.g. Home, Office, Shop" error={errors.label?.message} {...register('label')} />
        <TextField
          className="rise-2"
          label="Delivery address"
          autoComplete="street-address"
          placeholder="e.g. 12 Lakeview Street, GRA, Enugu"
          error={errors.address?.message}
          {...register('address')}
        />
        <UseMyLocation
          place="address_form"
          actionLabel="Use this address"
          className="rise-2"
          onFound={(location) => {
            setValue('address', location.address, { shouldValidate: true, shouldDirty: true })
            const found = areaForPlaces(zones.data ?? [], location.placeNames)
            if (found) {
              setArea(found)
              setAreaError(undefined)
            }
          }}
        />
        <MapFrame height={132} className="rise-2">
          <DetailsMapArt />
          <MapPin color="#11708C" ringColor="rgba(17,112,140,.35)" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[88%]" />
        </MapFrame>
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
              <b>This address can't be saved yet,</b> because it is outside the areas we serve.
            </>
          }
        />
        <TextField className="rise-3" label="Landmark" optional error={errors.landmark?.message} {...register('landmark')} />
        <Card className="rise-4 flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block font-bold">Make this my default</span>
            <span className="text-chip text-mute">Picked first when you order</span>
          </span>
          <Toggle
            label="Make this my default"
            checked={makeDefault}
            disabled={existing?.is_default || isFirst}
            onChange={(v) => setValue('make_default', v)}
          />
        </Card>
        {mutation.isError && !Object.keys(errors).length && <Notice tone="error">{errorMessage(mutation.error)}</Notice>}
      </form>
    </Shell>
  )
}
