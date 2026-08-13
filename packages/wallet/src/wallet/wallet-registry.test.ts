import { afterEach, describe, expect, test } from "bun:test"
import "fake-indexeddb/auto"

import { MissingWalletSeedError, WalletRegistry } from "./wallet-registry"

const PUBLIC_KEY_A = "a".repeat(64)
const PUBLIC_KEY_B = "b".repeat(64)
const REGISTRY_NAME = "npubcash-wallet-registry-test"
const DATABASE_PREFIX = "npubcash-wallet-test:"

async function createDatabase(name: string): Promise<void> {
  const request = indexedDB.open(name)
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

async function removeDatabase(name: string): Promise<void> {
  const request = indexedDB.deleteDatabase(name)
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

afterEach(async () => {
  for (const database of await indexedDB.databases()) {
    if (
      database.name === REGISTRY_NAME ||
      database.name?.startsWith(DATABASE_PREFIX)
    ) {
      await removeDatabase(database.name)
    }
  }
})

describe("WalletRegistry", () => {
  test("serializes first creation and reuses one Recovery Phrase", async () => {
    let generated = 0
    const registry = new WalletRegistry({
      databaseName: REGISTRY_NAME,
      walletDatabasePrefix: DATABASE_PREFIX,
      generateRecoveryPhrase: () => {
        generated += 1
        return "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
      },
    })

    const [first, second] = await Promise.all([
      registry.open(PUBLIC_KEY_A),
      registry.open(PUBLIC_KEY_A),
    ])

    expect(generated).toBe(1)
    expect(first.recoveryPhrase).toBe(second.recoveryPhrase)
    expect(first.databaseName).toBe(`${DATABASE_PREFIX}${PUBLIC_KEY_A}`)
    registry.close()
  })

  test("refuses an existing wallet database whose seed record is missing", async () => {
    await createDatabase(`${DATABASE_PREFIX}${PUBLIC_KEY_A}`)
    const registry = new WalletRegistry({
      databaseName: REGISTRY_NAME,
      walletDatabasePrefix: DATABASE_PREFIX,
    })

    expect(registry.open(PUBLIC_KEY_A)).rejects.toBeInstanceOf(
      MissingWalletSeedError
    )
    registry.close()
  })

  test("reuses the seed and reports when its wallet database disappeared", async () => {
    const registry = new WalletRegistry({
      databaseName: REGISTRY_NAME,
      walletDatabasePrefix: DATABASE_PREFIX,
      generateRecoveryPhrase: () =>
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    })

    const created = await registry.open(PUBLIC_KEY_A)
    const reopened = await registry.open(PUBLIC_KEY_A)

    expect(reopened.condition).toBe("database-recreated")
    expect(reopened.recoveryPhrase).toBe(created.recoveryPhrase)
    registry.close()
  })

  test("selects distinct installations for distinct Public Keys", async () => {
    let word = 0
    const registry = new WalletRegistry({
      databaseName: REGISTRY_NAME,
      walletDatabasePrefix: DATABASE_PREFIX,
      generateRecoveryPhrase: () => `phrase-${++word}`,
    })

    const first = await registry.open(PUBLIC_KEY_A)
    const second = await registry.open(PUBLIC_KEY_B)

    expect(first.databaseName).not.toBe(second.databaseName)
    expect(first.recoveryPhrase).not.toBe(second.recoveryPhrase)
    registry.close()
  })
})
