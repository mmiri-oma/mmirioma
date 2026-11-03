import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PencilIcon, PlusIcon } from '../../../components/icons/icons'
import { BackLink, MobileShell, ScrollArea, TopBar, TopBarSpacer, TopBarTitle } from '../../../components/layout/MobileShell'
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../../../components/layout/StateScreens'
import { MiniButton } from '../../../components/ui/Admin'
import { Card } from '../../../components/ui/Card'
import { Chip } from '../../../components/ui/Chip'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { IconLink } from '../../../components/ui/IconButton'
import { Notice } from '../../../components/ui/Notice'
import { errorMessage } from '../../../lib/api/errorMessage'
import { cx } from '../../../lib/cx'
import { AddressIcon } from '../components/AddressIcon'
import { AddressArea } from '../components/AreaPicker'
import { useAddresses, useRemoveAddress, useSetDefaultAddress } from '../queries'

/** Saved addresses (`c-saved`): make default, edit, remove, add. */
export function SavedAddresses() {
  const addresses = useAddresses()
  const setDefault = useSetDefaultAddress()
  const remove = useRemoveAddress()
  const [confirming, setConfirming] = useState<string | null>(null)
  const error = setDefault.error ?? remove.error
  const confirmingAddress = confirming ? addresses.data?.find((a) => a.id === confirming) : undefined

  return (
    <MobileShell>
      <TopBar left={<BackLink to="/menu" />} center={<TopBarTitle>Saved addresses</TopBarTitle>} right={<TopBarSpacer />} />
      <ScrollArea className="gap-3">
        <p className="rise-1 m-0 text-sub text-mute">
          Your default address is picked first when you order. You can still choose another one each time.
        </p>
        {addresses.isPending && <LoadingBlock label="Loading your addresses" />}
        {addresses.isError && <ErrorBlock error={addresses.error} onRetry={() => addresses.refetch()} />}
        {error && <Notice tone="error">{errorMessage(error)}</Notice>}
        {addresses.data?.length === 0 && <EmptyBlock title="No saved addresses" text="Add one to order faster next time." />}
        {addresses.data?.map((a) => (
          <Card
            key={a.id}
            className={cx(
              'rise-2 p-3.5 transition-[border-color,box-shadow] duration-[250ms]',
              a.is_default && 'border-2 border-primary shadow-[0_10px_22px_rgba(17,112,140,0.14)]',
            )}
          >
            <div className="flex items-start gap-3">
              <AddressIcon label={a.label} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-extrabold">{a.label}</span>
                  {a.is_default && <Chip className="animate-pop px-2 py-0.5 text-[11px]">Default</Chip>}
                </div>
                <div className="text-[13px] text-slate">{a.address}</div>
                {a.landmark && <div className="text-chip text-mute">{a.landmark}</div>}
                <AddressArea zone={a.zone} />
              </div>
              <IconLink to={`/addresses/${a.id}/edit`} label={`Edit ${a.label}`} className="size-[38px] text-mute">
                <PencilIcon size={18} />
              </IconLink>
            </div>
            {!a.is_default && (
              <div className="mt-2.5 flex gap-2">
                <MiniButton tone="alt" onClick={() => setDefault.mutate(a.id)} disabled={setDefault.isPending}>
                  Make default
                </MiniButton>
                <MiniButton tone="danger-soft" onClick={() => setConfirming(a.id)}>
                  Remove
                </MiniButton>
              </div>
            )}
          </Card>
        ))}
        <ConfirmDialog
          open={confirmingAddress !== undefined}
          title={`Remove ${confirmingAddress?.label ?? 'this address'}?`}
          confirmLabel="Remove"
          cancelLabel="Keep it"
          loading={remove.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => confirming && remove.mutate(confirming, { onSettled: () => setConfirming(null) })}
        >
          {confirmingAddress?.address}
        </ConfirmDialog>
        <Link
          to="/addresses/new"
          className="rise-3 flex min-h-14 items-center justify-center gap-2 rounded-option border-2 border-dashed border-blink bg-[#F4F9FF] font-extrabold text-primary no-underline hover:text-primary"
        >
          <PlusIcon size={18} strokeWidth={2.6} roundJoin={false} />
          Add a new address
        </Link>
      </ScrollArea>
    </MobileShell>
  )
}
