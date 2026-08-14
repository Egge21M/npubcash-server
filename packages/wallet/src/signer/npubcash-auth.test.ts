import { describe, expect, test } from "bun:test"

import { createNpubCashSigner } from "./npubcash-auth"

const PUBLIC_KEY = "a".repeat(64)

const template = {
  kind: 27235,
  created_at: 1_700_000_000,
  tags: [
    ["u", "https://npub.cash/api/v2/auth/nip98"],
    ["method", "GET"],
  ],
  content: "",
}

describe("npub.cash signer authentication", () => {
  test("signs an authentication template through the mode-independent signer interface", async () => {
    const signer = createNpubCashSigner(PUBLIC_KEY, {
      signEvent: async (event) => ({
        ...event,
        pubkey: PUBLIC_KEY,
        id: "1".repeat(64),
        sig: "2".repeat(128),
      }),
    })

    expect(await signer(template)).toEqual({
      ...template,
      pubkey: PUBLIC_KEY,
      id: "1".repeat(64),
      sig: "2".repeat(128),
    })
  })

  test("rejects a signed event belonging to another Recipient", async () => {
    const signer = createNpubCashSigner(PUBLIC_KEY, {
      signEvent: async (event) => ({
        ...event,
        pubkey: "b".repeat(64),
        id: "1".repeat(64),
        sig: "2".repeat(128),
      }),
    })

    await expect(signer(template)).rejects.toThrow("different Public Key")
  })
})
