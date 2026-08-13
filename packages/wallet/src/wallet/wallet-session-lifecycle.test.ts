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
      },
      () => events.push("runtime signer cleared")
    )

    expect(events).toEqual([
      "runtime close attempted",
      "signer removed",
      "runtime signer cleared",
    ])
  })

  test("clears the runtime signer when record removal rejects", async () => {
    const events: string[] = []

    await expect(
      forgetWalletSession(
        null,
        {
          removeActive: async () => {
            throw new Error("record removal failed")
          },
        },
        () => events.push("runtime signer cleared")
      )
    ).rejects.toThrow("record removal failed")
    expect(events).toEqual(["runtime signer cleared"])
  })
})
