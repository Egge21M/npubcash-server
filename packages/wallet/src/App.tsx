import { createBrowserRouter, RouterProvider } from "react-router-dom"

import { WalletRuntimeProvider } from "@/wallet/wallet-runtime-provider"
import {
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
          { path: "/settings", element: <SettingsPage /> },
          { path: "/settings/recovery", element: <RecoveryPage /> },
        ],
      },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}

export default App
