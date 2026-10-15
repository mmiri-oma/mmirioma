import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './components/layout/AdminShell'
import { AdminOrderDetailPage } from './features/admin-orders/AdminOrderDetailPage'
import { AdminOrdersPage } from './features/admin-orders/AdminOrdersPage'

/**
 * Route table. `/` redirects to the admin directory until the customer
 * ordering screens (S1-05) take over the root route.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/orders" replace />} />
      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<Navigate to="orders" replace />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="orders/:reference" element={<AdminOrderDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
