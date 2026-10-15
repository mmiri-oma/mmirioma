import { Navigate, Route, Routes } from 'react-router-dom'
import { AppGate } from './features/auth/components/AppGate'
import { CreateAccountPage } from './features/auth/pages/CreateAccountPage'
import { CustomerHome, StaffHome } from './features/auth/pages/HomePages'
import { SignInPage } from './features/auth/pages/SignInPage'
import { WelcomePage } from './features/auth/pages/WelcomePage'

/**
 * Routes of the single React app. The customer app lives at `/` and the
 * staff (dispatcher) app under `/staff`; the driver app follows with S1-15.
 * Each protected page sits behind {@link AppGate}.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <AppGate app="customer" signedOut={<WelcomePage />}>
            {(session) => <CustomerHome session={session} />}
          </AppGate>
        }
      />
      <Route path="/sign-in" element={<SignInPage app="customer" />} />
      <Route path="/create-account" element={<CreateAccountPage />} />
      <Route
        path="/staff"
        element={
          <AppGate app="staff">{(session) => <StaffHome session={session} />}</AppGate>
        }
      />
      <Route path="/staff/sign-in" element={<SignInPage app="staff" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
