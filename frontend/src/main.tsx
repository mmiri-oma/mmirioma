import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './App'
import { SessionProvider } from './features/auth/SessionProvider'
import {
  CustomerOrdersSourceContext,
  customerOrdersSource,
} from './features/customer-orders/source'
import './index.css'
import { createQueryClient } from './lib/queryClient'

const queryClient = createQueryClient()
const root = document.getElementById('root')
if (root === null) throw new Error('Missing #root element in index.html')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          {/* Customer order screens read the source chosen by VITE_ORDERS_SOURCE
              (lib/ordersData.ts); tests provide their own. */}
          <CustomerOrdersSourceContext value={customerOrdersSource}>
            <AppRoutes />
          </CustomerOrdersSourceContext>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
