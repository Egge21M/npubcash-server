import { describe, expect, test } from "bun:test"

import { parseWalletEnvironment } from "./environment"

describe("wallet environment", () => {
  test("accepts an HTTPS API origin and secure NIP-46 relays", () => {
    expect(
      parseWalletEnvironment({
        VITE_NPUBCASH_API_ORIGIN: "https://api.npub.cash/",
        VITE_NIP46_RELAYS:
          "wss://relay.example.com, wss://relay2.example.com/path",
      })
    ).toEqual({
      apiOrigin: "https://api.npub.cash",
      nip46Relays: [
        "wss://relay.example.com/",
        "wss://relay2.example.com/path",
      ],
    })
  })
})
