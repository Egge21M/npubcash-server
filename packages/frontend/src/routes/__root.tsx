import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { NavBar } from "@/components/NavBar"
import type { AuthContextType } from "@/contexts/AuthContext"

interface RouterContext {
  auth: AuthContextType
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}
