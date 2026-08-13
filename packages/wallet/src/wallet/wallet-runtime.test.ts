import { afterEach, describe, expect, test } from "bun:test"
import "fake-indexeddb/auto"

import type { Manager } from "@cashu/coco-core"

import type { WalletInstallation } from "./wallet-registry"

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
    const runtime = await openWalletRuntime(installation)

    expect((await runtime.balance()).spendable.toNumber()).toBe(0)
    expect(runtime.npubCashAccountCount()).toBe(0)
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
})
