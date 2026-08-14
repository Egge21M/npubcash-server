import { describe, expect, test } from "bun:test"

import { forgetWalletSession } from "./wallet-session-lifecycle"

describe("forgetWalletSession", () => {
  test("attempts remote logout before teardown and always removes the local record", async () => {
    const events: string[] = []

    await forgetWalletSession(
      {
        close: async () => {
          events.push("runtime closed")
        },
      },
      {
        removeActive: async () => {
          events.push("signer removed")
        },
      },
      () => events.push("client key cleared"),
      async () => {
        events.push("remote logout attempted")
        throw new Error("remote unavailable")
      }
    )

    expect(events).toEqual([
      "remote logout attempted",
      "signer removed",
      "client key cleared",
      "runtime closed",
    ])
  })

  test("removes the signer record before runtime teardown", async () => {
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
      "signer removed",
      "runtime signer cleared",
      "runtime close attempted",
    ])
  })

  test("clears the runtime signer when record removal rejects", async () => {
    const events: string[] = []

    await expect(
      forgetWalletSession(
        {
          close: async () => {
            events.push("runtime closed")
          },
        },
        {
          removeActive: async () => {
            throw new Error("record removal failed")
          },
        },
        () => events.push("runtime signer cleared")
      )
    ).rejects.toThrow("record removal failed")
    expect(events).toEqual(["runtime signer cleared", "runtime closed"])
  })

  test("closes the runtime when clearing the in-memory signer rejects", async () => {
    const events: string[] = []

    await expect(
      forgetWalletSession(
        {
          close: async () => {
            events.push("runtime closed")
          },
        },
        {
          removeActive: async () => {
            events.push("signer removed")
          },
        },
        async () => {
          throw new Error("signer cleanup failed")
        }
      )
    ).rejects.toThrow("signer cleanup failed")
    expect(events).toEqual(["signer removed", "runtime closed"])
  })
})
