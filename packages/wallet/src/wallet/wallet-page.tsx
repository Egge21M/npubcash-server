import { useTrustedBalance } from "@cashu/coco-react"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  InboxIcon,
  ShieldAlertIcon,
} from "lucide-react"

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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useWalletRuntime } from "./wallet-runtime-context"

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

      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>Payments</EmptyTitle>
          <EmptyDescription>
            No payments are waiting to be claimed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  )
}
