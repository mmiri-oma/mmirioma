import { useEffect, useRef, useState, type ReactNode } from 'react'
import { track } from '../../../lib/analytics'
import { formatPhone } from '../../../lib/format/phone'
import { AREA_NAMES } from '../content'
import { useSupportContact } from '../queries'
import { AreaCheck } from './AreaCheck'

/**
 * A button that opens the area check in a pop-up, so "Do you deliver to me?"
 * is one tap from the header or the hero instead of a long scroll. The
 * pop-up is a native modal `<dialog>`: focus stays inside, Escape and a tap
 * outside close it, and focus returns to the button.
 */
export function AreaCheckButton({ children, className, place, label }: { children: ReactNode; className?: string; place: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true)
          track('area_check_open', { place })
        }}
      >
        {children}
      </button>
      {open && <AreaCheckDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function AreaCheckDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const contact = useSupportContact()
  // Open as a modal once mounted; closing (Escape, backdrop, the button) unmounts it through `onClose`.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby="wl-area-dialog-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="wl-area-dialog"
    >
      <div className="wl-area-dialog-inner">
        <div className="wl-area-dialog-head">
          <h2 id="wl-area-dialog-title">Do we deliver to you?</h2>
          <button type="button" className="wl-area-dialog-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="wl-area-dialog-note">A sample list while our first zone is confirmed. Type your area or use your location.</p>
        <AreaCheck areas={AREA_NAMES} phoneLabel={formatPhone(contact.phone)} phoneHref={`tel:${contact.phone}`} autoFocus />
      </div>
    </dialog>
  )
}
