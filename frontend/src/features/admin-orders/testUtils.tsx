import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AdminOrderDetailPage } from './AdminOrderDetailPage'
import { AdminOrdersPage } from './AdminOrdersPage'
import { createMockAdminOrdersSource } from './mockAdminOrders'
import { AdminOrdersSourceContext, type AdminOrdersSource } from './source'

/**
 * Render the admin order routes at `url` with an injectable data source and a
 * fresh, non-retrying query client.
 *
 * @returns The render result plus `currentUrl()`, the router's path and query.
 */
export function renderAdminOrders(url: string, source: AdminOrdersSource = createMockAdminOrdersSource({ latencyMs: 0 })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/admin/orders', element: <AdminOrdersPage /> },
      { path: '/admin/orders/:reference', element: <AdminOrderDetailPage /> },
    ],
    { initialEntries: [url] },
  )
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AdminOrdersSourceContext value={source}>
        <RouterProvider router={router} />
      </AdminOrdersSourceContext>
    </QueryClientProvider>,
  )
  const currentUrl = () => router.state.location.pathname + router.state.location.search
  return { ...result, currentUrl }
}
