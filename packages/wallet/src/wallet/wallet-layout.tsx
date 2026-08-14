import { HistoryIcon, SettingsIcon, WalletCardsIcon } from "lucide-react"
import { Link, Navigate, NavLink, Outlet } from "react-router-dom"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useWalletRuntime } from "./wallet-runtime-context"
import {
  DirectNsecUnlockPage,
  FailurePage,
  InitializationPage,
  NewWalletWarningPage,
} from "./wallet-session-screens"

function Navigation() {
  const destinations = [
    { to: "/wallet", label: "Wallet", icon: WalletCardsIcon },
    { to: "/activity", label: "Activity", icon: HistoryIcon },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ]

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-4 py-2 backdrop-blur sm:static sm:border-t-0 sm:bg-transparent sm:p-0"
    >
      <div className="mx-auto flex max-w-lg justify-around gap-2 sm:justify-end">
        {destinations.map(({ to, label, icon: Icon }) => (
          <NavLink
            className={({ isActive }) =>
              cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "flex-1 sm:flex-none",
                isActive && "bg-muted"
              )
            }
            key={to}
            to={to}
          >
            {({ isActive }) => (
              <>
                <Icon data-icon="inline-start" />
                <span>{label}</span>
                {isActive && <span className="sr-only">(current)</span>}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function AppShell() {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link className="font-semibold tracking-tight" to="/wallet">
            npub.cash
          </Link>
          <div className="hidden sm:block">
            <Navigation />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 pb-24 sm:pb-8">
        <Outlet />
      </main>
      <div className="sm:hidden">
        <Navigation />
      </div>
    </div>
  )
}

export function AuthenticatedLayout() {
  const { state } = useWalletRuntime()

  if (state.phase === "initializing") {
    return <InitializationPage stage={state.stage} />
  }
  if (state.phase === "new-wallet-warning") return <NewWalletWarningPage />
  if (state.phase === "direct-nsec-unlock") {
    return <DirectNsecUnlockPage />
  }
  if (state.phase === "failed") return <FailurePage />
  if (state.phase === "signed-out") return <Navigate replace to="/" />
  if (
    state.phase === "nip46-pairing" ||
    state.phase === "nip46-reconnecting" ||
    state.phase === "nip46-unavailable"
  ) {
    return <Navigate replace to="/" />
  }
  return <AppShell />
}
