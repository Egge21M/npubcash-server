import { CircleAlertIcon, KeyRoundIcon, ShieldAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  type InitializationStage,
  useWalletRuntime,
} from "./wallet-runtime-context"

const INITIALIZATION_STEPS: Array<{
  id: InitializationStage
  label: string
}> = [
  { id: "restoring-session", label: "Restoring signer session" },
  { id: "verifying-signer", label: "Verifying signer" },
  { id: "opening-wallet", label: "Opening local Wallet" },
  { id: "starting-coco", label: "Starting Coco" },
  { id: "connecting-npubcash", label: "Connecting npub.cash" },
  { id: "checking-payments", label: "Checking payments" },
]

function useStorageDurabilityWarning(): boolean {
  const [warning, setWarning] = useState(
    () => typeof navigator.storage?.persisted !== "function"
  )

  useEffect(() => {
    if (!navigator.storage?.persisted) return

    void navigator.storage.persisted().then((persisted) => {
      setWarning(!persisted)
    })
  }, [])

  return warning
}

export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-6 p-6">
      {children}
    </main>
  )
}

export function InitializationPage({ stage }: { stage: InitializationStage }) {
  const activeIndex = INITIALIZATION_STEPS.findIndex(
    (step) => step.id === stage
  )

  return (
    <PageFrame>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">npub.cash</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Opening your Wallet
        </h1>
        <p className="text-sm text-muted-foreground">
          Wallet Material stays in this browser.
        </p>
      </div>
      <ol className="flex flex-col gap-3" aria-live="polite">
        {INITIALIZATION_STEPS.map((step, index) => (
          <li
            aria-current={index === activeIndex ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
              index === activeIndex && "bg-muted font-medium",
              index > activeIndex && "text-muted-foreground"
            )}
            key={step.id}
          >
            {index === activeIndex ? (
              <Spinner aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="size-4 text-center">
                {index < activeIndex ? "✓" : "·"}
              </span>
            )}
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </PageFrame>
  )
}

function SignInPage() {
  const { extensionAvailable, signInWithNip07 } = useWalletRuntime()
  const storageWarning = useStorageDurabilityWarning()

  return (
    <PageFrame>
      <div className="flex flex-col gap-2 text-center">
        <p className="text-sm font-medium text-primary">npub.cash</p>
        <h1 className="text-3xl font-semibold tracking-tight">Your payments</h1>
        <p className="text-muted-foreground">
          Open the Wallet for your Nostr identity.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign in with Nostr</CardTitle>
          <CardDescription>
            Your browser extension confirms which local Wallet to open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            disabled={!extensionAvailable}
            onClick={() => void signInWithNip07()}
          >
            <KeyRoundIcon data-icon="inline-start" />
            Continue with browser extension
          </Button>
          {!extensionAvailable && (
            <p className="text-sm text-muted-foreground" role="status">
              No NIP-07 extension detected. Enable one and this page will
              update.
            </p>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            The extension&apos;s private key never enters npub.cash.
          </p>
        </CardFooter>
      </Card>

      <Alert>
        <ShieldAlertIcon />
        <AlertTitle>This Wallet lives in browser data</AlertTitle>
        <AlertDescription>
          Clearing site data or losing this browser profile removes local ecash
          and history. A Recovery Phrase is created for the Wallet, but this
          release cannot import or restore it.
        </AlertDescription>
      </Alert>

      {storageWarning && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Storage may be temporary</AlertTitle>
          <AlertDescription>
            Private browsing and non-persistent storage can be erased when the
            browser session ends. Use a regular browser profile for durable
            Wallet Material.
          </AlertDescription>
        </Alert>
      )}
    </PageFrame>
  )
}

export function FailurePage() {
  const { state, retry, signOut, removeStrandedWallet } = useWalletRuntime()

  if (state.phase !== "failed") return null

  const canRetry = state.kind !== "missing-wallet-seed"

  return (
    <PageFrame>
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Wallet could not open safely</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap gap-2">
        {canRetry && <Button onClick={() => void retry()}>Retry</Button>}
        <Button variant="outline" onClick={() => void signOut()}>
          Sign Out
        </Button>
      </div>

      {state.kind === "missing-wallet-seed" && (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" />}>
            Remove stranded local Wallet
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove local Wallet data?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the local Coco database for this Public
                Key. Any ecash proofs still stored there will be lost. This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void removeStrandedWallet()}
              >
                Remove local Wallet
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageFrame>
  )
}

export function NewWalletWarningPage() {
  const { continueOpeningWallet } = useWalletRuntime()

  return (
    <PageFrame>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">npub.cash</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Your local Wallet is ready
        </h1>
        <p className="text-sm text-muted-foreground">
          Before opening it, understand where its Wallet Material lives.
        </p>
      </div>

      <Alert>
        <ShieldAlertIcon />
        <AlertTitle>This Wallet exists only in this browser</AlertTitle>
        <AlertDescription>
          Clearing site data, using private browsing, or losing this browser
          profile can remove local ecash and history. A 12-word Recovery Phrase
          has been created, but this release cannot import or restore it.
        </AlertDescription>
      </Alert>

      <Button onClick={() => void continueOpeningWallet()}>Open Wallet</Button>
    </PageFrame>
  )
}

export function HomeRoute() {
  const { state } = useWalletRuntime()

  if (state.phase === "open") return <Navigate replace to="/wallet" />
  if (state.phase === "initializing") {
    return <InitializationPage stage={state.stage} />
  }
  if (state.phase === "new-wallet-warning") return <NewWalletWarningPage />
  if (state.phase === "failed") return <FailurePage />
  return <SignInPage />
}
