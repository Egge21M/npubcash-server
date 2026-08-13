import { describe, expect, test } from "bun:test"

import { Nip07PublicKeyMismatchError, Nip07SignerAdapter } from "./nip07"

const PUBLIC_KEY = "A".repeat(64)

describe("Nip07SignerAdapter", () => {
  test("normalizes the extension Public Key", async () => {
    const adapter = new Nip07SignerAdapter({
      getPublicKey: async () => PUBLIC_KEY,
      signEvent: async (event) => ({ ...event, id: "id", sig: "sig" }),
    })

    expect(await adapter.open()).toBe(PUBLIC_KEY.toLowerCase())
  })

  test("refuses to restore a different Public Key", async () => {
    const adapter = new Nip07SignerAdapter({
      getPublicKey: async () => "b".repeat(64),
      signEvent: async (event) => ({ ...event, id: "id", sig: "sig" }),
    })

    expect(adapter.open("c".repeat(64))).rejects.toBeInstanceOf(
      Nip07PublicKeyMismatchError
    )
  })
})
