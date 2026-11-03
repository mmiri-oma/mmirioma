import { Outlet } from 'react-router-dom'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { RequireRole } from '../auth/RequireRole'
import { CustomerDesktopHeader } from './components/CustomerChrome'
import { OrderDraftProvider } from './order/OrderDraftProvider'

/** The width from which the customer app uses its desktop layout (Tailwind `lg`). */
const DESKTOP = '(min-width: 1024px)'

/**
 * Layout route for every signed-in customer screen. On laptops and desktops
 * it adds the desktop header, and `.customer-app` switches the phone frames
 * to the desktop layout (styles/components.css, "Customer app on desktop").
 */
export function CustomerArea() {
  const desktop = useMediaQuery(DESKTOP)
  return (
    <RequireRole role="customer">
      <OrderDraftProvider>
        <div className="customer-app">
          {desktop && <CustomerDesktopHeader />}
          <Outlet />
        </div>
      </OrderDraftProvider>
    </RequireRole>
  )
}
