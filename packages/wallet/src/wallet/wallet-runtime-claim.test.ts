import { afterEach, describe, expect, test } from "bun:test"
import "fake-indexeddb/auto"

import {
  createBlindSignature,
  createNewMintKeys,
  pointFromHex,
} from "@cashu/cashu-ts"

import type { NostrEventSigner } from "@/signer/npubcash-auth"
import type { WalletInstallation } from "./wallet-registry"
import type { WalletRuntime } from "./wallet-runtime"

const PUBLIC_KEY = "a".repeat(64)
const MINT_URL = "https://mint.example"
const originalFetch = globalThis.fetch
const openRuntimes: WalletRuntime[] = []
const databaseNames = new Set<string>()
const localValues = new Map<string, string>()

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => localValues.set(key, value),
    removeItem: (key: string) => localValues.delete(key),
  },
})

const signer: NostrEventSigner = {
  signEvent: async (event) => ({
    ...event,
    pubkey: PUBLIC_KEY,
    id: "1".repeat(64),
    sig: "2".repeat(128),
  }),
}

function installation(name: string): WalletInstallation {
  databaseNames.add(name)
  return {
    version: 1,
    publicKey: PUBLIC_KEY,
    databaseName: name,
    recoveryPhrase:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    createdAt: 0,
    condition: "existing",
  }
}

type Quote = {
  quoteId: string
  mintUrl: string
  amount: number
  expiresAt: number
  paidAt: number
  request: string
  locked?: boolean
}

class DeterministicBoundaries {
  readonly keyset = createNewMintKeys(16, new Uint8Array(32).fill(7))
  readonly quotes: Quote[]
  mintAttempts = 0

  constructor(quotes: Quote[]) {
    this.quotes = quotes
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    )
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })

    if (url.origin === "https://npub.cash") {
      if (url.pathname === "/api/v2/auth/nip98") {
        return json({ error: false, data: { token: "test-jwt" } })
      }
      if (url.pathname === "/api/v2/wallet/quotes") {
        return json({
          error: false,
          data: { quotes: this.quotes },
          metadata: { total: this.quotes.length, limit: 50 },
        })
      }
    }

    if (url.origin === MINT_URL) {
      if (url.pathname === "/v1/info") {
        return json({
          name: "Deterministic mint",
          version: "Nutshell/0.17.0",
          nuts: {
            "4": {
              methods: [
                {
                  method: "bolt11",
                  unit: "sat",
                  min_amount: 1,
                  max_amount: 1_000_000,
                },
              ],
              disabled: false,
            },
            "5": { methods: [], disabled: true },
          },
        })
      }
      if (url.pathname === "/v1/keysets") {
        return json({
          keysets: [
            {
              id: this.keyset.keysetId,
              unit: "sat",
              active: true,
              input_fee_ppk: 0,
            },
          ],
        })
      }
      if (url.pathname.startsWith("/v1/keys")) {
        return json({
          keysets: [
            {
              id: this.keyset.keysetId,
              unit: "sat",
              active: true,
              keys: Object.fromEntries(
                Object.entries(this.keyset.pubKeys).map(([amount, key]) => [
                  amount,
                  Buffer.from(key).toString("hex"),
                ])
              ),
            },
          ],
        })
      }
      if (url.pathname.startsWith("/v1/mint/quote/bolt11/")) {
        const quoteId = url.pathname.split("/").at(-1)!
        const quote = this.quotes.find(
          (candidate) => candidate.quoteId === quoteId
        )
        return json({
          quote: quoteId,
          request: quote?.request ?? "",
          state: "PAID",
          expiry: quote?.expiresAt ?? 1_800_000_000,
          amount: quote?.amount ?? 0,
          unit: "sat",
        })
      }
      if (url.pathname === "/v1/mint/bolt11") {
        this.mintAttempts += 1
        const payload = JSON.parse(String(init?.body)) as {
          outputs: Array<{ amount: number; B_: string; id: string }>
        }
        return json({
          signatures: payload.outputs.map((output) => {
            const privateKey = this.keyset.privKeys[String(output.amount)]
            if (!privateKey) throw new Error("Missing deterministic mint key")
            const signature = createBlindSignature(
              pointFromHex(output.B_),
              privateKey,
              output.id
            )
            return {
              amount: output.amount,
              id: output.id,
              C_: signature.C_.toHex(true),
            }
          }),
        })
      }
    }

    return json({ message: `Unexpected request: ${url.pathname}` }, 404)
  }
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(openRuntimes.splice(0).map((runtime) => runtime.close()))
  for (const name of databaseNames) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    })
  }
  databaseNames.clear()
  localValues.clear()
})

describe("WalletRuntime paid quote integration", () => {
  test("claims and persists one ordinary quote through the real Manager and NPC path", async () => {
    const { openWalletRuntime } = await import("./wallet-runtime")
    const boundaries = new DeterministicBoundaries([
      {
        quoteId: "quote-one",
        mintUrl: MINT_URL,
        amount: 21,
        expiresAt: 1_800_000_000,
        paidAt: 1_700_000_000,
        request: "lnbc21",
        locked: false,
      },
    ])
    globalThis.fetch = boundaries.fetch
    const wallet = installation("npubcash-claim-integration")

    let runtime = await openWalletRuntime(wallet, signer)
    openRuntimes.push(runtime)
    await runtime.syncPayments()

    expect((await runtime.balance()).spendable.toNumber()).toBe(21)
    expect(runtime.npubCashAccountCount()).toBe(1)
    expect(boundaries.mintAttempts).toBe(1)

    await runtime.syncPayments()
    expect((await runtime.balance()).spendable.toNumber()).toBe(21)
    expect(boundaries.mintAttempts).toBe(1)

    await runtime.close()
    openRuntimes.splice(openRuntimes.indexOf(runtime), 1)
    runtime = await openWalletRuntime(wallet, signer)
    openRuntimes.push(runtime)
    await runtime.syncPayments()

    expect((await runtime.balance()).spendable.toNumber()).toBe(21)
    expect(boundaries.mintAttempts).toBe(1)
  })

  test("never submits a protected payment to Coco or its mint", async () => {
    const { openWalletRuntime } = await import("./wallet-runtime")
    const boundaries = new DeterministicBoundaries([
      {
        quoteId: "locked-quote",
        mintUrl: MINT_URL,
        amount: 34,
        expiresAt: 1_800_000_000,
        paidAt: 1_700_000_000,
        request: "lnbc34",
        locked: true,
      },
    ])
    globalThis.fetch = boundaries.fetch
    const runtime = await openWalletRuntime(
      installation("npubcash-locked-integration"),
      signer
    )
    openRuntimes.push(runtime)

    await runtime.syncPayments()

    expect(boundaries.mintAttempts).toBe(0)
    expect((await runtime.balance()).spendable.toNumber()).toBe(0)
    expect(runtime.paymentSyncSnapshot().issues).toContainEqual(
      expect.objectContaining({
        kind: "protected-payment",
        title: "Protected payment unsupported",
      })
    )
  })

  test("never submits a quote whose required lock marker is absent", async () => {
    const { openWalletRuntime } = await import("./wallet-runtime")
    const boundaries = new DeterministicBoundaries([
      {
        quoteId: "missing-lock-marker",
        mintUrl: MINT_URL,
        amount: 55,
        expiresAt: 1_800_000_000,
        paidAt: 1_700_000_001,
        request: "lnbc55",
      },
    ])
    globalThis.fetch = boundaries.fetch
    const runtime = await openWalletRuntime(
      installation("npubcash-missing-lock-marker-integration"),
      signer
    )
    openRuntimes.push(runtime)

    await runtime.syncPayments()

    expect(boundaries.mintAttempts).toBe(0)
    expect((await runtime.balance()).spendable.toNumber()).toBe(0)
    expect(runtime.paymentSyncSnapshot().issues).toContainEqual(
      expect.objectContaining({ kind: "malformed-quote" })
    )
  })
})
