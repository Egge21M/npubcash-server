import { describe, expect, test } from "bun:test"

import { forgetWalletSession } from "./wallet-session-lifecycle"

describe("forgetWalletSession", () => {
  test("removes the signer record after runtime teardown rejects", async () => {
    const events: string[] = []

    await forgetWalletSession(
      {
        close: async () => {
          events.push("runtime close attempted")
          throw new Error("close failed")
        },
      },
      {
        removeActive: async () => {
          events.push("signer removed")
        },
      }
    )

    expect(events).toEqual(["runtime close attempted", "signer removed"])
  })
})
