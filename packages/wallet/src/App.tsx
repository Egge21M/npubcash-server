import { createBrowserRouter, RouterProvider } from "react-router-dom"

import { Toaster } from "@/components/ui/toast"
import { WalletRuntimeProvider } from "@/wallet/wallet-runtime-provider"
import {
  ActivityDetailPage,
  ActivityPage,
  AuthenticatedLayout,
  HomeRoute,
  RecoveryPage,
  RouteErrorPage,
  SettingsPage,
  WalletPage,
} from "@/wallet/wallet-screens"

const router = createBrowserRouter([
  {
    element: <WalletRuntimeProvider />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <HomeRoute /> },
      {
        element: <AuthenticatedLayout />,
        children: [
          { path: "/wallet", element: <WalletPage /> },
          { path: "/activity", element: <ActivityPage /> },
          {
            path: "/activity/:operationId",
            element: <ActivityDetailPage />,
          },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/settings/recovery", element: <RecoveryPage /> },
        ],
      },
    ],
  },
])

export function App() {
  return (
    <Toaster>
      <RouterProvider router={router} />
    </Toaster>
  )
}

export default App
