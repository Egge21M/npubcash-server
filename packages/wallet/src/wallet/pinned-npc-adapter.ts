import type { Logger } from "@cashu/coco-core"
import type { NPCAccountApi, StructuredLogger } from "coco-cashu-plugin-npc"

import {
  filterSafeNpubCashQuotes,
  GuardedNpubCashSinceStore,
  type NpubCashQuoteIssue,
} from "./npubcash-quote-guard"

export type PinnedNPCIssue = {
  kind: "mint-unavailable" | "claim-failed"
  title: string
  message: string
}

export interface PinnedNPCQuoteObserver {
  checking(): void
  inspected(issues: NpubCashQuoteIssue[]): void
  failed(error: unknown): void
}

type PinnedNPCAccountShape = {
  runtime?: {
    client?: {
      getQuotesSince(since: number): Promise<unknown[]>
    }
  }
}

function issueForNPCDiagnostic(message: string): PinnedNPCIssue {
  if (message.includes("Failed to add trusted mint for quotes")) {
    return {
      kind: "mint-unavailable",
      title: "Payment mint unavailable",
      message:
        "The Wallet could not reach this payment's mint and will check npub.cash again.",
    }
  }
  if (message.includes("Failed to import quote")) {
    return {
      kind: "claim-failed",
      title: "Payment claim did not finish",
      message:
        "The Wallet will reconcile Coco's persisted state and check npub.cash again.",
    }
  }
  return {
    kind: "claim-failed",
    title: "Payment synchronization did not finish",
    message:
      "The Wallet could not finish reconciling this payment and will check its persisted state again.",
  }
}

/**
 * Adapts the exact pinned NPC tuple's string-only diagnostics into safe Wallet
 * issues. Unknown diagnostics remain visible as a generic failure so package
 * wording changes cannot silently remove the Recipient's failure state.
 */
export class PinnedNPCLogger implements StructuredLogger, Logger {
  private readonly reportIssue: (issue: PinnedNPCIssue) => void

  constructor(reportIssue: (issue: PinnedNPCIssue) => void) {
    this.reportIssue = reportIssue
  }

  child(): PinnedNPCLogger {
    return this
  }

  error(message: string): void {
    this.reportIssue(issueForNPCDiagnostic(message))
  }

  warn(): void {}
  info(): void {}
  debug(): void {}
  log(): void {}
}

/**
 * Installs the pre-import quote policy at the only available seam in the exact
 * pinned NPC tuple. The runtime assertion deliberately fails closed if that
 * package shape changes.
 */
export function installPinnedNPCQuoteGuard(
  account: NPCAccountApi,
  sinceStore: GuardedNpubCashSinceStore,
  observer: PinnedNPCQuoteObserver
): void {
  const client = (account as unknown as PinnedNPCAccountShape).runtime?.client
  if (!client || typeof client.getQuotesSince !== "function") {
    throw new Error(
      "The pinned npub.cash plugin no longer exposes its quote safety seam."
    )
  }
  const fetchQuotes = client.getQuotesSince.bind(client)

  client.getQuotesSince = async (since: number) => {
    observer.checking()
    try {
      const values = await fetchQuotes(since)
      const filtered = filterSafeNpubCashQuotes(values)
      if (filtered.earliestProtectedPaidAt !== null) {
        sinceStore.blockAt(filtered.earliestProtectedPaidAt)
      }
      observer.inspected(filtered.issues)
      return filtered.accepted
    } catch (error) {
      observer.failed(error)
      throw error
    }
  }
}
