import {
  ChevronDownIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { openDirectNsec } from "@/signer/direct-nsec"
import { MINIMUM_SIGNER_PASSPHRASE_LENGTH } from "@/signer/signer-vault"
import { secondsUntilUnlock } from "@/signer/unlock-rate-limit"
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
  const { extensionAvailable, signInWithDirectNsec, signInWithNip07 } =
    useWalletRuntime()
  const storageWarning = useStorageDurabilityWarning()
  const [nsec, setNsec] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [setupState, setSetupState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "failed"; message: string }
  >({ status: "idle" })
  const [errors, setErrors] = useState<{
    nsec?: string
    passphrase?: string
    confirmation?: string
  }>({})

  const submitDirectNsec = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: typeof errors = {}

    try {
      const signer = openDirectNsec(nsec)
      signer.destroy()
    } catch {
      nextErrors.nsec = "Enter a valid nsec Identity Secret."
    }
    if (passphrase.length < MINIMUM_SIGNER_PASSPHRASE_LENGTH) {
      nextErrors.passphrase = `Use at least ${MINIMUM_SIGNER_PASSPHRASE_LENGTH} characters.`
    }
    if (confirmation !== passphrase) {
      nextErrors.confirmation = "The passphrases do not match."
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSetupState({ status: "submitting" })
    const result = await signInWithDirectNsec(nsec, passphrase)
    if (!result.ok) {
      setSetupState({ status: "failed", message: result.message })
    }
  }

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
            Your active signer confirms which local Wallet to open.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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

          <Collapsible>
            <CollapsibleTrigger
              render={<Button variant="ghost" className="w-full" />}
            >
              Use an nsec
              <ChevronDownIcon data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div className="flex flex-col gap-4">
                <Alert>
                  <ShieldAlertIcon />
                  <AlertTitle>
                    Your nsec controls your Nostr identity
                  </AlertTitle>
                  <AlertDescription>
                    It is encrypted in this browser with your passphrase. The
                    passphrase does not encrypt locally held ecash or Wallet
                    history. Never send either value to npub.cash support.
                  </AlertDescription>
                </Alert>

                <form
                  className="flex flex-col gap-5"
                  onSubmit={(event) => void submitDirectNsec(event)}
                >
                  <FieldGroup>
                    <Field data-invalid={Boolean(errors.nsec)}>
                      <FieldLabel htmlFor="direct-nsec">nsec</FieldLabel>
                      <Input
                        aria-invalid={Boolean(errors.nsec)}
                        autoCapitalize="none"
                        autoComplete="off"
                        id="direct-nsec"
                        onChange={(event) => setNsec(event.target.value)}
                        spellCheck={false}
                        type="password"
                        value={nsec}
                      />
                      <FieldDescription>
                        The Identity Secret is encrypted before it is saved.
                      </FieldDescription>
                      <FieldError>{errors.nsec}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(errors.passphrase)}>
                      <FieldLabel htmlFor="direct-passphrase">
                        Passphrase
                      </FieldLabel>
                      <Input
                        aria-invalid={Boolean(errors.passphrase)}
                        autoComplete="new-password"
                        id="direct-passphrase"
                        onChange={(event) => setPassphrase(event.target.value)}
                        type="password"
                        value={passphrase}
                      />
                      <FieldDescription>
                        Use {MINIMUM_SIGNER_PASSPHRASE_LENGTH} or more
                        characters. You will enter it after every reload.
                      </FieldDescription>
                      <FieldError>{errors.passphrase}</FieldError>
                    </Field>

                    <Field data-invalid={Boolean(errors.confirmation)}>
                      <FieldLabel htmlFor="direct-passphrase-confirmation">
                        Confirm passphrase
                      </FieldLabel>
                      <Input
                        aria-invalid={Boolean(errors.confirmation)}
                        autoComplete="new-password"
                        id="direct-passphrase-confirmation"
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                        type="password"
                        value={confirmation}
                      />
                      <FieldError>{errors.confirmation}</FieldError>
                    </Field>
                  </FieldGroup>

                  {setupState.status === "failed" && (
                    <Alert variant="destructive">
                      <CircleAlertIcon />
                      <AlertTitle>Signer could not be saved</AlertTitle>
                      <AlertDescription>{setupState.message}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    disabled={setupState.status === "submitting"}
                    type="submit"
                  >
                    {setupState.status === "submitting" && (
                      <Spinner data-icon="inline-start" />
                    )}
                    {setupState.status === "submitting"
                      ? "Protecting signer…"
                      : "Protect and open Wallet"}
                  </Button>
                </form>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Signer credentials stay in this browser and are never sent to
            npub.cash.
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

  const canRetry = ![
    "missing-wallet-seed",
    "signer-record-corrupt",
    "signer-record-unsupported",
  ].includes(state.kind)

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

export function DirectNsecUnlockPage() {
  const { state, unlockDirectNsec, forgetDirectNsec } = useWalletRuntime()
  const [passphrase, setPassphrase] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const retryAt =
    state.phase === "direct-nsec-unlock" ? (state.retryAt ?? 0) : 0

  useEffect(() => {
    if (retryAt <= now) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [now, retryAt])

  if (state.phase !== "direct-nsec-unlock") return null

  const pending = state.status === "decrypting"
  const forgetting = state.status === "forgetting"
  const failed = state.status === "failed"
  const retrySeconds = secondsUntilUnlock(retryAt, now)
  const rateLimited = retrySeconds > 0

  return (
    <PageFrame>
      <div className="flex flex-col gap-2 text-center">
        <p className="text-sm font-medium text-primary">npub.cash</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Unlock your signer
        </h1>
        <p className="text-muted-foreground">
          Enter the passphrase for this browser session.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Direct nsec signer</CardTitle>
          <CardDescription>
            Verifying {state.expectedPublicKey.slice(0, 12)}… before opening its
            local Wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void unlockDirectNsec(passphrase)
            }}
          >
            <FieldGroup>
              <Field
                data-disabled={pending || forgetting}
                data-invalid={failed}
              >
                <FieldLabel htmlFor="unlock-passphrase">Passphrase</FieldLabel>
                <Input
                  aria-invalid={failed}
                  autoComplete="current-password"
                  autoFocus
                  disabled={pending || forgetting}
                  id="unlock-passphrase"
                  onChange={(event) => setPassphrase(event.target.value)}
                  type="password"
                  value={passphrase}
                />
                <FieldError>{state.message}</FieldError>
              </Field>
            </FieldGroup>
            <Button
              disabled={
                pending || forgetting || rateLimited || passphrase.length === 0
              }
              type="submit"
            >
              {pending && <Spinner data-icon="inline-start" />}
              {pending
                ? "Decrypting signer…"
                : rateLimited
                  ? `Try again in ${retrySeconds}s`
                  : "Unlock Wallet"}
            </Button>
          </form>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            The decrypted Identity Secret stays in runtime memory only until
            Sign Out or this page closes. Brief pauses limit attempts on this
            page, but cannot prevent offline guessing of a copied signer record.
          </p>
        </CardFooter>
      </Card>

      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="ghost" />}>
          Forgot passphrase
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget encrypted signer?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes only the encrypted direct-nsec signer record. It does
              not delete the Wallet seed, Coco database, proofs, history, or
              other Wallet Material. Enter the same nsec again to reopen this
              Wallet Installation with a new passphrase.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={forgetting}
              variant="destructive"
              onClick={() => void forgetDirectNsec()}
            >
              {forgetting && <Spinner data-icon="inline-start" />}
              Forget signer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  if (state.phase === "direct-nsec-unlock") {
    return <DirectNsecUnlockPage />
  }
  if (state.phase === "failed") return <FailurePage />
  return <SignInPage />
}
