import { describe, expect, test } from "bun:test"
import { Amount, type HistoryEntry } from "@cashu/coco-core"

import {
  groupClaimHistory,
  projectClaimOperation,
  resolveClaimDetailState,
  type ClaimOperationRecord,
} from "./claim-activity"

const amount = (value: number) => ({ toNumber: () => value })

function operation(
  state: ClaimOperationRecord["state"],
  overrides: Partial<ClaimOperationRecord> = {}
): ClaimOperationRecord {
  return {
    id: "operation-one",
    mintUrl: "https://mint.example",
    amount: amount(21),
    unit: "sat",
    state,
    createdAt: Date.UTC(2026, 7, 13, 12),
    updatedAt: Date.UTC(2026, 7, 14, 12),
    ...overrides,
  }
}

describe("claim Activity projection", () => {
  test("an operation that has not loaded has no claim detail yet", () => {
    expect(resolveClaimDetailState(null, null)).toEqual({
      operation: null,
      claim: null,
      commandError: null,
      commandPending: false,
      automaticReconciliationPending: false,
      canRecover: false,
    })
  })

  test.each([
    ["init", "Preparing", "preparing", false, false],
    ["pending", "Waiting", "pending", false, true],
    ["executing", "Reconciling", "reconciling", false, true],
    ["finalized", "Claimed", "complete", false, false],
    ["failed", "Failed", "failed", false, false],
  ] as const)(
    "maps Coco %s without inventing a replacement action",
    (state, badgeLabel, presentationState, canRetry, shouldReconcile) => {
      expect(projectClaimOperation(operation(state))).toMatchObject({
        operationId: "operation-one",
        amount: 21,
        mintHost: "mint.example",
        cocoState: state,
        badgeLabel,
        presentationState,
        canRetry,
        shouldReconcile,
      })
    }
  )

  test("a pending claim with an error is recoverable on the same operation", () => {
    expect(
      projectClaimOperation(
        operation("pending", { error: "Mint temporarily unavailable" })
      )
    ).toMatchObject({
      operationId: "operation-one",
      presentationState: "recoverable",
      badgeLabel: "Retry available",
      canRetry: true,
      shouldReconcile: false,
      diagnostic: "Mint temporarily unavailable",
    })
  })

  test("an unsuccessful reconciliation keeps exact-operation recovery available", () => {
    const pending = operation("pending")

    expect(
      resolveClaimDetailState(pending, {
        operationId: pending.id,
        attemptedState: pending.state,
        attemptedUpdatedAt: pending.updatedAt,
        error:
          "The Wallet could not reconcile this claim. Its persisted operation is unchanged.",
      })
    ).toMatchObject({
      claim: { operationId: pending.id, presentationState: "pending" },
      commandError:
        "The Wallet could not reconcile this claim. Its persisted operation is unchanged.",
      canRecover: true,
    })
  })

  test("a newer persisted operation clears an earlier reconciliation error", () => {
    const attempted = operation("pending")
    const finalized = operation("finalized", {
      updatedAt: attempted.updatedAt + 1,
    })

    expect(
      resolveClaimDetailState(finalized, {
        operationId: attempted.id,
        attemptedState: attempted.state,
        attemptedUpdatedAt: attempted.updatedAt,
        error: "The earlier reconciliation did not finish.",
      })
    ).toMatchObject({
      claim: { presentationState: "complete", badgeLabel: "Claimed" },
      commandError: null,
      canRecover: false,
    })
  })

  test("a failed claim remains terminal even when metadata calls it retryable", () => {
    expect(
      projectClaimOperation(
        operation("failed", {
          error: "Quote expired",
          terminalFailure: {
            reason: "Quote expired",
            code: "quote_expired",
            retryable: true,
            observedAt: Date.UTC(2026, 7, 14, 12),
          },
        })
      )
    ).toMatchObject({
      presentationState: "failed",
      canRetry: false,
      shouldReconcile: false,
      diagnostic: "Quote expired",
      failureCode: "quote_expired",
    })
  })

  test("a finalized claim with unrecovered proofs is not presented as custody success", () => {
    expect(
      projectClaimOperation(
        operation("finalized", {
          error: "Quote issued but proofs could not be restored",
        })
      )
    ).toMatchObject({
      presentationState: "failed",
      badgeLabel: "Incomplete",
      title: "Claim needs review",
      canRetry: false,
      diagnostic: "Quote issued but proofs could not be restored",
    })
  })

  test("redacts bearer material from persisted diagnostics", () => {
    const projection = projectClaimOperation(
      operation("failed", {
        error:
          "Mint rejected lnbc2100secretinvoice and cashuBsecretbearertoken",
      })
    )

    expect(projection.diagnostic).toBe(
      "Mint rejected [redacted] and [redacted]"
    )
  })

  test("groups durable claim history by local calendar date newest first", () => {
    const records: HistoryEntry[] = [
      {
        id: "history-old",
        source: "operation",
        type: "mint",
        operationId: "operation-old",
        mintUrl: "https://mint.example",
        amount: Amount.from(8),
        unit: "sat",
        state: "finalized",
        paymentRequest: "lnbc8",
        quoteId: "quote-old",
        createdAt: Date.UTC(2026, 7, 12, 9),
        updatedAt: Date.UTC(2026, 7, 12, 10),
      },
      {
        id: "history-new",
        source: "operation",
        type: "mint",
        operationId: "operation-new",
        mintUrl: "https://mint.example",
        amount: Amount.from(13),
        unit: "sat",
        state: "pending",
        paymentRequest: "lnbc13",
        quoteId: "quote-new",
        createdAt: Date.UTC(2026, 7, 14, 9),
        updatedAt: Date.UTC(2026, 7, 14, 10),
      },
      {
        id: "legacy",
        source: "legacy",
        legacyHistoryId: "legacy",
        type: "mint",
        mintUrl: "https://mint.example",
        amount: Amount.from(5),
        unit: "sat",
        state: "PAID",
        paymentRequest: "lnbc5",
        quoteId: "quote-legacy",
        createdAt: Date.UTC(2026, 7, 13, 9),
        updatedAt: Date.UTC(2026, 7, 13, 10),
      },
    ]

    expect(groupClaimHistory(records)).toEqual([
      {
        dateKey: "2026-08-14",
        timestamp: Date.UTC(2026, 7, 14, 10),
        claims: [
          expect.objectContaining({ operationId: "operation-new", amount: 13 }),
        ],
      },
      {
        dateKey: "2026-08-12",
        timestamp: Date.UTC(2026, 7, 12, 10),
        claims: [
          expect.objectContaining({ operationId: "operation-old", amount: 8 }),
        ],
      },
    ])
  })
})
