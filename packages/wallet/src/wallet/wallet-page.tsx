import { useTrustedBalance } from "@cashu/coco-react"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  InboxIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { useEffect, useRef, useSyncExternalStore } from "react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { useWalletRuntime } from "./wallet-runtime-context"
import type { WalletRuntime } from "./wallet-runtime"

function PaymentSyncStatus({ runtime }: { runtime: WalletRuntime }) {
  const snapshot = useSyncExternalStore(
    (listener) => runtime.subscribePaymentSync(listener),
    () => runtime.paymentSyncSnapshot(),
    () => runtime.paymentSyncSnapshot()
  )
  const toastedOperation = useRef<string | null>(null)

  useEffect(() => {
    const success = snapshot.lastSuccess
    if (!success || toastedOperation.current === success.operationId) return
    toastedOperation.current = success.operationId
    toast.add({
      title: `${success.amount} sat added to your balance`,
      description: `Claimed from ${new URL(success.mintUrl).host}.`,
      type: "success",
      timeout: 4_000,
    })
  }, [snapshot.lastSuccess])

  const hasProblems = snapshot.issues.length > 0

  return (
    <section className="flex flex-col gap-3" aria-labelledby="payments-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="payments-title" className="text-sm font-medium">
          Payments
        </h2>
        <Badge
          variant={hasProblems ? "destructive" : "outline"}
          aria-live="polite"
        >
          {snapshot.checking && <Spinner data-icon="inline-start" />}
          {snapshot.checking
            ? "Checking npub.cash"
            : hasProblems
              ? "Needs attention"
              : "Up to date"}
        </Badge>
      </div>

      {snapshot.claims.map((claim) => (
        <Alert key={claim.operationId}>
          <Spinner />
          <AlertTitle>
            {claim.state === "executing" ? "Claiming" : "Claim pending"}{" "}
            {claim.amount} sat
          </AlertTitle>
          <AlertDescription>
            Coco has persisted this claim from {new URL(claim.mintUrl).host}.
            The Wallet will reconcile it without creating a duplicate.
          </AlertDescription>
        </Alert>
      ))}

      {snapshot.issues.map((issue, index) => (
        <Alert
          key={`${issue.kind}:${index}`}
          variant={
            issue.kind === "protected-payment" ? "default" : "destructive"
          }
        >
          <CircleAlertIcon />
          <AlertTitle>{issue.title}</AlertTitle>
          <AlertDescription>{issue.message}</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              disabled={snapshot.checking}
              onClick={() => void runtime.syncPayments()}
            >
              {snapshot.checking ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Check again
            </Button>
          </AlertAction>
        </Alert>
      ))}

      {snapshot.claims.length === 0 && snapshot.issues.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>No payments waiting</EmptyTitle>
            <EmptyDescription>
              Paid npub.cash payments will be claimed automatically while this
              Wallet is open and online.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}

export function WalletPage() {
  const { state } = useWalletRuntime()
  const { balances } = useTrustedBalance()

  if (state.phase !== "open") return null

  const mintBalances = Object.entries(balances.byMint)

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Wallet</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your balance</h1>
      </div>

      {state.installation.condition === "created" && (
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>New Wallet created in this browser</AlertTitle>
          <AlertDescription>
            Keep this browser profile and review your Recovery Phrase in
            Settings. This release cannot restore from the phrase yet.
          </AlertDescription>
        </Alert>
      )}

      {state.installation.condition === "database-recreated" && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Local Wallet database was missing</AlertTitle>
          <AlertDescription>
            An empty database was recreated from the same Recovery Phrase. Local
            proofs and Activity that were only in the missing database are
            absent.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Available</CardTitle>
          <CardDescription>
            Spendable ecash across trusted mints
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-semibold tracking-tight">
            {balances.total.spendable.toNumber()} sat
          </p>
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
              Mint breakdown
              <ChevronDownIcon data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {mintBalances.length === 0 ? (
                <p className="pt-2 text-sm text-muted-foreground">
                  No trusted mints hold a balance yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 pt-2">
                  {mintBalances.map(([mintUrl, balance]) => (
                    <li
                      className="flex justify-between gap-4 text-sm"
                      key={mintUrl}
                    >
                      <span className="truncate">{new URL(mintUrl).host}</span>
                      <span>{balance.spendable.toNumber()} sat</span>
                    </li>
                  ))}
                </ul>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Balance is read directly from Coco&apos;s persisted proofs.
          </p>
        </CardFooter>
      </Card>

      <PaymentSyncStatus runtime={state.runtime} />
    </>
  )
}
