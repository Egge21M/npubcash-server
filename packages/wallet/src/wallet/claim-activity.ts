import {
  isOperationHistoryEntry,
  type HistoryEntry,
  type MintHistoryEntry,
  type MintOperation,
} from "@cashu/coco-core"

type AmountView = { toNumber(): number }

export type ClaimOperationRecord = Pick<
  MintOperation,
  "id" | "mintUrl" | "unit" | "state" | "createdAt" | "updatedAt"
> & {
  amount: AmountView
  error?: string
  terminalFailure?: {
    reason: string
    code?: string
    retryable?: boolean
    observedAt: number
  }
}

export type ClaimPresentationState =
  | "preparing"
  | "pending"
  | "recoverable"
  | "reconciling"
  | "complete"
  | "failed"

export interface ClaimActivityProjection {
  operationId: string
  mintUrl: string
  mintHost: string
  amount: number
  unit: string
  cocoState: ClaimOperationRecord["state"]
  presentationState: ClaimPresentationState
  badgeLabel: string
  title: string
  description: string
  createdAt: number
  updatedAt: number
  canRetry: boolean
  shouldReconcile: boolean
  diagnostic?: string
  failureCode?: string
}

export interface ClaimHistoryGroup {
  dateKey: string
  timestamp: number
  claims: ClaimActivityProjection[]
}

export interface ClaimRecoveryCommandResult {
  operationId: string
  attemptedState: ClaimOperationRecord["state"]
  attemptedUpdatedAt: number
  operation?: ClaimOperationRecord
  error?: string
  pending?: "retrying"
}

export interface ClaimDetailState {
  operation: ClaimOperationRecord | null
  claim: ClaimActivityProjection | null
  commandError: string | null
  commandPending: boolean
  automaticReconciliationPending: boolean
  canRecover: boolean
}

function mintHost(mintUrl: string): string {
  try {
    return new URL(mintUrl).host
  } catch {
    return "Unknown mint"
  }
}

function sanitizeDiagnostic(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value
    .replace(/\b(?:lnbc|lntb|lnbcrt)[a-z0-9]+\b/gi, "[redacted]")
    .replace(/\bcashu[ab][a-z0-9_-]+\b/gi, "[redacted]")
    .replace(/\bnsec1[a-z0-9]+\b/gi, "[redacted]")
    .slice(0, 300)
}

export function projectClaimOperation(
  operation: ClaimOperationRecord
): ClaimActivityProjection {
  const base = {
    operationId: operation.id,
    mintUrl: operation.mintUrl,
    mintHost: mintHost(operation.mintUrl),
    amount: operation.amount.toNumber(),
    unit: operation.unit,
    cocoState: operation.state,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    canRetry: false,
    shouldReconcile: false,
    diagnostic: sanitizeDiagnostic(
      operation.terminalFailure?.reason ?? operation.error
    ),
    failureCode: operation.terminalFailure?.code,
  }

  switch (operation.state) {
    case "init":
      return {
        ...base,
        presentationState: "preparing",
        badgeLabel: "Preparing",
        title: "Preparing claim",
        description:
          "Coco recorded the claim intent but has not prepared it for the mint.",
      }
    case "pending":
      if (operation.error) {
        return {
          ...base,
          presentationState: "recoverable",
          badgeLabel: "Retry available",
          title: "Claim needs attention",
          description:
            "Coco kept this claim pending so it can safely retry the same operation.",
          canRetry: true,
        }
      }
      return {
        ...base,
        presentationState: "pending",
        badgeLabel: "Waiting",
        title: "Claim pending",
        description:
          "The claim is waiting for the mint and will be checked again safely.",
        shouldReconcile: true,
      }
    case "executing":
      return {
        ...base,
        presentationState: "reconciling",
        badgeLabel: "Reconciling",
        title: "Reconciling claim",
        description:
          "Coco is checking whether the mint issued this claim before doing more work.",
        shouldReconcile: true,
      }
    case "finalized":
      if (operation.error) {
        return {
          ...base,
          presentationState: "failed",
          badgeLabel: "Incomplete",
          title: "Claim needs review",
          description:
            "The mint reports this claim as issued, but Coco could not confirm that its proofs were restored locally.",
        }
      }
      return {
        ...base,
        presentationState: "complete",
        badgeLabel: "Claimed",
        title: "Payment claimed",
        description: "The mint issued this payment and Coco saved the proofs.",
      }
    case "failed":
      return {
        ...base,
        presentationState: "failed",
        badgeLabel: "Failed",
        title: "Claim could not complete",
        description:
          "Coco marked this operation as terminal. Retrying would require different work, so this Wallet will not create a replacement claim.",
      }
  }
}

export function resolveClaimDetailState(
  hookOperation: ClaimOperationRecord | null,
  commandResult: ClaimRecoveryCommandResult | null
): ClaimDetailState {
  const commandApplies =
    commandResult !== null &&
    hookOperation !== null &&
    commandResult.operationId === hookOperation.id &&
    commandResult.attemptedState === hookOperation.state &&
    commandResult.attemptedUpdatedAt === hookOperation.updatedAt
  const command = commandApplies ? commandResult : null
  const operation = command?.operation ?? hookOperation
  const claim = operation ? projectClaimOperation(operation) : null
  const commandError = command?.error ?? null
  const commandPending = command?.pending === "retrying"

  return {
    operation,
    claim,
    commandError,
    commandPending,
    automaticReconciliationPending:
      claim?.shouldReconcile === true && command === null,
    canRecover:
      claim?.canRetry === true ||
      (commandError !== null && claim?.shouldReconcile === true),
  }
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function groupClaimHistory(
  history: readonly HistoryEntry[]
): ClaimHistoryGroup[] {
  const claims = history
    .filter(
      (entry): entry is MintHistoryEntry =>
        isOperationHistoryEntry(entry) && entry.type === "mint"
    )
    .map((entry) =>
      projectClaimOperation({
        id: entry.operationId,
        mintUrl: entry.mintUrl,
        amount: entry.amount,
        unit: entry.unit,
        state: entry.state,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        error: entry.error,
      })
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.operationId.localeCompare(left.operationId)
    )

  const groups = new Map<string, ClaimHistoryGroup>()
  for (const claim of claims) {
    const dateKey = localDateKey(claim.updatedAt)
    const group = groups.get(dateKey)
    if (group) {
      group.claims.push(claim)
    } else {
      groups.set(dateKey, {
        dateKey,
        timestamp: claim.updatedAt,
        claims: [claim],
      })
    }
  }
  return [...groups.values()]
}
