import { describe, expect, test } from "bun:test"

import { PinnedNPCLogger, type PinnedNPCIssue } from "./pinned-npc-adapter"

describe("pinned NPC adapter", () => {
  test("maps the pinned mint diagnostic without retaining its metadata", () => {
    const issues: PinnedNPCIssue[] = []
    const logger = new PinnedNPCLogger((issue) => issues.push(issue))

    logger.error(
      "[npc] Failed to add trusted mint for quotes | mintUrl=https://mint.example"
    )

    expect(issues).toEqual([
      {
        kind: "mint-unavailable",
        title: "Payment mint unavailable",
        message:
          "The Wallet could not reach this payment's mint and will check npub.cash again.",
      },
    ])
  })

  test("keeps unknown dependency diagnostics visible as a safe failure", () => {
    const issues: PinnedNPCIssue[] = []
    const logger = new PinnedNPCLogger((issue) => issues.push(issue))

    logger.error("The pinned dependency changed this diagnostic")

    expect(issues).toEqual([
      {
        kind: "claim-failed",
        title: "Payment synchronization did not finish",
        message:
          "The Wallet could not finish reconciling this payment and will check its persisted state again.",
      },
    ])
  })
})
