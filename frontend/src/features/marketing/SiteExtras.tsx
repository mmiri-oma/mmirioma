import { useEffect, useState } from 'react'
import { WHATSAPP_GREETING, whatsappLink } from '../../lib/whatsapp'
import { ArrowUpIcon, WhatsAppIcon } from './icons'
import { useWhatsappNumber } from './queries'

/** Scroll distance (px) after which "Back to top" appears: about one screen on a phone. */
const SHOW_BACK_TO_TOP_AFTER = 600

/**
 * Floating buttons in the bottom-right corner of the public pages: "Back to
 * top" (once the page is scrolled) above "Chat on WhatsApp" (always).
 * The WhatsApp label shows from 640 px; on phones the button is the icon
 * with an accessible name, so it does not cover the page.
 */
export function FloatingActions() {
  const whatsapp = useWhatsappNumber()
  const [showTop, setShowTop] = useState(false)

  // Show "Back to top" only after a screenful of scrolling. Passive listener:
  // it never blocks scrolling; the cleanup removes it when the page closes.
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > SHOW_BACK_TO_TOP_AFTER)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function backToTop() {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' })
    // Keyboard users continue from the top of the page, not from this button.
    document.querySelector<HTMLElement>('header a')?.focus({ preventScroll: true })
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {showTop && (
        <button
          type="button"
          onClick={backToTop}
          aria-label="Back to top"
          className="rise-1 pointer-events-auto flex size-12 cursor-pointer items-center justify-center rounded-[14px] border-[1.5px] border-solid border-input-line bg-white text-ink shadow-[0_8px_24px_rgba(10,37,64,0.16)] transition-colors duration-150 hover:border-primary hover:bg-mk-panel hover:text-primary"
        >
          <ArrowUpIcon />
        </button>
      )}
      {/* Hidden while WhatsApp support is off (FR-055, docs/api/public-site.md). */}
      {whatsapp && (
        <a
          href={whatsappLink(whatsapp, WHATSAPP_GREETING)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with Waterline on WhatsApp (opens WhatsApp)"
          className="pointer-events-auto flex min-h-14 min-w-14 items-center justify-center gap-2.5 rounded-[18px] bg-[#1DA851] px-4 text-[15px] font-bold text-white no-underline shadow-[0_10px_28px_rgba(16,120,60,0.35)] transition-colors duration-150 hover:bg-[#178A43] hover:text-white"
        >
          <WhatsAppIcon size={26} />
          <span className="hidden sm:inline">Chat on WhatsApp</span>
        </a>
      )}
    </div>
  )
}
