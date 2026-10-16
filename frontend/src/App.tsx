import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './components/layout/AdminShell'
import { AdminOrderDetailPage } from './features/admin-orders/AdminOrderDetailPage'
import { adminOrdersSource } from './features/admin-orders/apiAdminOrdersSource'
import { AdminOrdersSourceContext } from './features/admin-orders/source'
import { AdminOrdersPage } from './features/admin-orders/AdminOrdersPage'
import { AppGate } from './features/auth/components/AppGate'
import { CreateAccountPage } from './features/auth/pages/CreateAccountPage'
import { SignInPage } from './features/auth/pages/SignInPage'
import { WelcomePage } from './features/auth/pages/WelcomePage'
import { CustomerSignInPage } from './features/customer-orders/pages/CustomerSignInPage'
import { MyOrdersPage } from './features/customer-orders/pages/MyOrdersPage'
import { OrderDetailPage } from './features/customer-orders/pages/OrderDetailPage'
import { RequestReceivedPage } from './features/customer-orders/pages/RequestReceivedPage'
import { RequestWaterPage } from './features/customer-orders/pages/RequestWaterPage'
import { RequestDraftSignOutSync } from './features/customer-orders/requestDraft'

/**
 * Route table of the single React app. The customer app lives at `/` and the
 * staff (dispatcher) app under `/admin`; the driver app follows with S1-15.
 * Protected pages sit behind {@link AppGate}, which shows the splash, the
 * sign-in redirect or the wrong-app screen as needed.
 */
export function AppRoutes() {
  return (
    <>
      <RequestDraftSignOutSync />
      <Routes>
        <Route
          path="/"
          element={
            <AppGate app="customer" signedOut={<WelcomePage />}>
              {(session) => <MyOrdersPage session={session} />}
            </AppGate>
          }
        />
        <Route
          path="/request"
          element={
            <AppGate app="customer">
              {(session) => <RequestWaterPage session={session} />}
            </AppGate>
          }
        />
        <Route
          path="/request/received"
          element={
            <AppGate app="customer">
              {(session) => <RequestReceivedPage session={session} />}
            </AppGate>
          }
        />
        <Route
          path="/orders/:reference"
          element={
            <AppGate app="customer">
              {(session) => <OrderDetailPage session={session} />}
            </AppGate>
          }
        />
        <Route path="/sign-in" element={<CustomerSignInPage />} />
        <Route path="/create-account" element={<CreateAccountPage />} />

        <Route path="/admin/sign-in" element={<SignInPage app="staff" />} />
        <Route
          path="/admin"
          element={
            <AppGate app="staff">
              {(session) => (
                <AdminOrdersSourceContext value={adminOrdersSource}>
                  <AdminShell user={session.user} />
                </AdminOrdersSourceContext>
              )}
            </AppGate>
          }
        >
          <Route index element={<Navigate to="orders" replace />} />
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="orders/:reference" element={<AdminOrderDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
