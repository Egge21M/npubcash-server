import { afterEach, describe, expect, test } from "bun:test"
import "fake-indexeddb/auto"

import type { Manager } from "@cashu/coco-core"

import type { WalletInstallation } from "./wallet-registry"

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
})

const signer = {
  signEvent: async (event: {
    kind: number
    created_at: number
    tags: string[][]
    content: string
  }) => ({
    ...event,
    pubkey: installation.publicKey,
    id: "1".repeat(64),
    sig: "2".repeat(128),
  }),
}

const installation: WalletInstallation = {
  version: 1,
  publicKey: "a".repeat(64),
  databaseName: "npubcash-wallet-runtime-test",
  recoveryPhrase:
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  createdAt: 0,
  condition: "created",
}

afterEach(async () => {
  const request = indexedDB.deleteDatabase(installation.databaseName)
  await new Promise<void>((resolve) => {
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
  })
})

describe("WalletRuntime", () => {
  test("opens a real Coco wallet with a zero trusted balance", async () => {
    const { openWalletRuntime } = await import("./wallet-runtime")
    const runtime = await openWalletRuntime(installation, signer)

    expect((await runtime.balance()).spendable.toNumber()).toBe(0)
    expect(runtime.npubCashAccountCount()).toBe(1)
    await runtime.close()
  })

  test("disposes Coco before closing its IndexedDB connection", async () => {
    const { WalletRuntime } = await import("./wallet-runtime")
    const events: string[] = []
    const runtime = new WalletRuntime(
      {
        dispose: async () => {
          events.push("manager disposed")
        },
      } as unknown as Manager,
      {
        close: () => {
          events.push("database closed")
        },
      }
    )

    await runtime.close()
    expect(events).toEqual(["manager disposed", "database closed"])
  })

  test("closes IndexedDB when Coco disposal rejects", async () => {
    const { WalletRuntime } = await import("./wallet-runtime")
    const events: string[] = []
    const runtime = new WalletRuntime(
      {
        dispose: async () => {
          events.push("manager disposal attempted")
          throw new Error("dispose failed")
        },
      } as unknown as Manager,
      {
        close: () => {
          events.push("database closed")
        },
      }
    )

    await expect(runtime.close()).rejects.toThrow("dispose failed")
    expect(events).toEqual(["manager disposal attempted", "database closed"])
  })

  test("keeps a precise API failure when NPC also emits a generic diagnostic", async () => {
    const { WalletRuntime } = await import("./wallet-runtime")
    const runtime = new WalletRuntime({} as Manager, { close: () => undefined })

    runtime.reportNpubCashFailure({ statusCode: 401 })
    runtime.reportNPCIssue({
      kind: "claim-failed",
      title: "Payment synchronization did not finish",
      message: "generic",
    })

    expect(runtime.paymentSyncSnapshot().issues).toEqual([
      expect.objectContaining({ kind: "api-authorization" }),
    ])
  })
})
