import {
  useManager,
  useMintOperation,
  usePaginatedHistory,
} from "@cashu/coco-react"
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  HistoryIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  groupClaimHistory,
  resolveClaimDetailState,
  type ClaimActivityProjection,
  type ClaimOperationRecord,
  type ClaimRecoveryCommandResult,
} from "./claim-activity"
import type { WalletRuntime } from "./wallet-runtime"
import { useWalletRuntime } from "./wallet-runtime-context"

function badgeVariant(claim: ClaimActivityProjection) {
  if (
    claim.presentationState === "failed" ||
    claim.presentationState === "recoverable"
  ) {
    return "destructive" as const
  }
  if (claim.presentationState === "complete") return "secondary" as const
  return "outline" as const
}

function formatDateGroup(timestamp: number): string {
  const target = new Date(timestamp)
  const today = new Date()
  const targetDay = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime()
  const todayDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime()
  const dayDifference = Math.round((todayDay - targetDay) / 86_400_000)
  if (dayDifference === 0) return "Today"
  if (dayDifference === 1) return "Yesterday"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(target)
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp))
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading Activity">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

const ACTIVITY_PAGE_SIZE = 50

export function ActivityPage() {
  const manager = useManager()
  const { history, isFetching, hasMore, loadMore, refresh } =
    usePaginatedHistory(ACTIVITY_PAGE_SIZE)
  const [historyReadStatus, setHistoryReadStatus] = useState<
    "checking" | "available" | "failed"
  >("checking")
  const [historyCommandPending, setHistoryCommandPending] = useState(false)
  const [historyReadConfirmed, setHistoryReadConfirmed] = useState(false)
  const initialRefreshStarted = useRef(false)
  const groups = useMemo(() => groupClaimHistory(history), [history])

  useEffect(() => {
    let active = true
    void manager.history.getPaginatedHistory(0, 1).then(
      () => {
        if (active) setHistoryReadConfirmed(true)
      },
      () => {
        if (active) setHistoryReadStatus("failed")
      }
    )
    return () => {
      active = false
    }
  }, [manager])

  useEffect(() => {
    if (
      !historyReadConfirmed ||
      historyReadStatus !== "checking" ||
      isFetching ||
      initialRefreshStarted.current
    ) {
      return
    }
    initialRefreshStarted.current = true
    void Promise.resolve()
      .then(refresh)
      .then(() => setHistoryReadStatus("available"))
  }, [historyReadConfirmed, historyReadStatus, isFetching, refresh])

  async function retryHistoryRead(): Promise<void> {
    setHistoryCommandPending(true)
    try {
      await manager.history.getPaginatedHistory(0, 1)
      await refresh()
      setHistoryReadConfirmed(true)
      setHistoryReadStatus("available")
    } catch {
      setHistoryReadStatus("failed")
    } finally {
      setHistoryCommandPending(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Wallet history</p>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      </div>

      {historyReadStatus === "checking" ? (
        <ActivitySkeleton />
      ) : historyReadStatus === "failed" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Activity is unavailable</AlertTitle>
          <AlertDescription>
            Coco could not read the Wallet&apos;s persisted history. This is not
            an empty Activity state.
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              disabled={historyCommandPending}
              onClick={() => void retryHistoryRead()}
            >
              {historyCommandPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              {historyCommandPending ? "Retrying Activity" : "Try again"}
            </Button>
          </AlertAction>
        </Alert>
      ) : groups.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>No Activity yet</EmptyTitle>
            <EmptyDescription>
              Claims will appear here after Coco records them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section
              className="flex flex-col gap-2"
              key={group.dateKey}
              aria-labelledby={`activity-${group.dateKey}`}
            >
              <h2
                className="text-sm font-medium text-muted-foreground"
                id={`activity-${group.dateKey}`}
              >
                {formatDateGroup(group.timestamp)}
              </h2>
              <ItemGroup>
                {group.claims.map((claim) => (
                  <Item
                    key={claim.operationId}
                    variant="outline"
                    render={<Link to={`/activity/${claim.operationId}`} />}
                  >
                    <ItemContent>
                      <ItemTitle>
                        {claim.title} · {claim.amount} {claim.unit}
                      </ItemTitle>
                      <ItemDescription>
                        {claim.mintHost} · {formatTimestamp(claim.updatedAt)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={badgeVariant(claim)}>
                        {claim.badgeLabel}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          ))}
          {hasMore && (
            <Button
              variant="outline"
              disabled={isFetching}
              onClick={() => void loadMore()}
            >
              {isFetching && <Spinner data-icon="inline-start" />}
              {isFetching ? "Loading Activity" : "Load more"}
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading claim details">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-9 w-40" />
    </div>
  )
}

async function runClaimRecoveryCommand(
  runtime: WalletRuntime,
  attemptedOperation: ClaimOperationRecord,
  failureMessage: string
): Promise<ClaimRecoveryCommandResult> {
  const attempt = {
    operationId: attemptedOperation.id,
    attemptedState: attemptedOperation.state,
    attemptedUpdatedAt: attemptedOperation.updatedAt,
  }
  try {
    const operation = await runtime.recoverClaim(attemptedOperation.id)
    if (!operation) {
      return {
        ...attempt,
        error:
          "The persisted claim operation no longer exists. No replacement work was created.",
      }
    }
    return { ...attempt, operation }
  } catch {
    return { ...attempt, error: failureMessage }
  }
}

function ActivityOperationDetail({ operationId }: { operationId: string }) {
  const { state } = useWalletRuntime()
  const operationHook = useMintOperation(operationId)
  const [commandResult, setCommandResult] =
    useState<ClaimRecoveryCommandResult | null>(null)
  const reconciliationAttempt = useRef<string | null>(null)

  const hookOperation =
    operationHook.currentOperation as ClaimOperationRecord | null
  const {
    operation,
    claim,
    commandError,
    commandPending,
    automaticReconciliationPending,
    canRecover,
  } = resolveClaimDetailState(hookOperation, commandResult)

  useEffect(() => {
    if (state.phase !== "open" || !operation || !claim?.shouldReconcile) return
    const attemptKey = `${claim.operationId}:${claim.cocoState}:${claim.updatedAt}`
    if (reconciliationAttempt.current === attemptKey) return
    reconciliationAttempt.current = attemptKey
    void runClaimRecoveryCommand(
      state.runtime,
      operation,
      "The Wallet could not reconcile this claim. Its persisted operation is unchanged."
    ).then(setCommandResult)
  }, [claim, operation, state])

  async function retryClaim() {
    if (state.phase !== "open" || !operation || !canRecover || commandPending) {
      return
    }
    setCommandResult({
      operationId: operation.id,
      attemptedState: operation.state,
      attemptedUpdatedAt: operation.updatedAt,
      pending: "retrying",
    })
    setCommandResult(
      await runClaimRecoveryCommand(
        state.runtime,
        operation,
        "The retry did not complete. Coco retained the same operation so it can be checked again safely."
      )
    )
  }

  if (
    !operation &&
    (operationHook.status === "idle" || operationHook.isLoading)
  ) {
    return <DetailSkeleton />
  }

  if (!operation && operationHook.isError) {
    const notFound = /not found/i.test(operationHook.error?.message ?? "")
    if (notFound) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>Claim not found</EmptyTitle>
            <EmptyDescription>
              No Coco claim operation exists for this identifier. No new work
              was created.
            </EmptyDescription>
          </EmptyHeader>
          <Link
            className={buttonVariants({ variant: "outline" })}
            to="/activity"
          >
            Return to Activity
          </Link>
        </Empty>
      )
    }
    throw operationHook.error
  }

  if (!claim) return <DetailSkeleton />

  return (
    <>
      <Link
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-fit"
        )}
        to="/activity"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Activity
      </Link>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Claim details</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {claim.amount} {claim.unit}
        </h1>
      </div>

      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{claim.title}</ItemTitle>
          <ItemDescription>{claim.description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant={badgeVariant(claim)} aria-live="polite">
            {(commandPending || automaticReconciliationPending) && (
              <Spinner data-icon="inline-start" />
            )}
            {commandPending
              ? "Retrying"
              : automaticReconciliationPending
                ? "Reconciling"
                : claim.badgeLabel}
          </Badge>
        </ItemActions>
      </Item>

      {claim.presentationState === "recoverable" && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>This claim can be retried safely</AlertTitle>
          <AlertDescription>
            Retry rechecks and continues operation {claim.operationId}. It does
            not import the quote again or create a replacement claim.
          </AlertDescription>
        </Alert>
      )}

      {claim.presentationState === "failed" && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>This claim is terminal</AlertTitle>
          <AlertDescription>
            Coco will not retry this operation. The details below can help
            explain what happened without creating new work.
          </AlertDescription>
        </Alert>
      )}

      {commandError && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Claim reconciliation did not finish</AlertTitle>
          <AlertDescription>{commandError}</AlertDescription>
        </Alert>
      )}

      {canRecover && (
        <Button disabled={commandPending} onClick={() => void retryClaim()}>
          {commandPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {commandPending ? "Retrying claim" : "Retry this claim"}
        </Button>
      )}

      <Collapsible>
        <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
          Technical details
          <ChevronDownIcon data-icon="inline-end" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Operation</dt>
            <dd className="min-w-0 break-all">{claim.operationId}</dd>
            <dt className="text-muted-foreground">Coco state</dt>
            <dd>{claim.cocoState}</dd>
            <dt className="text-muted-foreground">Mint</dt>
            <dd className="min-w-0 break-all">{claim.mintUrl}</dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd>{formatTimestamp(claim.updatedAt)}</dd>
            {claim.failureCode && (
              <>
                <dt className="text-muted-foreground">Failure code</dt>
                <dd>{claim.failureCode}</dd>
              </>
            )}
            {claim.diagnostic && (
              <>
                <dt className="text-muted-foreground">Diagnostic</dt>
                <dd className="min-w-0 break-words">{claim.diagnostic}</dd>
              </>
            )}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}

export function ActivityDetailPage() {
  const { operationId = "" } = useParams()
  return <ActivityOperationDetail key={operationId} operationId={operationId} />
}
