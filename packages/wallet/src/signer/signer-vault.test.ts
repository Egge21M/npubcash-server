import { afterEach, describe, expect, test } from "bun:test"
import "fake-indexeddb/auto"

import { SignerVault } from "./signer-vault"

const PUBLIC_KEY = "a".repeat(64)

afterEach(async () => {
  await indexedDB.deleteDatabase("npubcash-signer-vault-test")
})

describe("SignerVault", () => {
  test("persists only the expected NIP-07 Public Key and removes it on Sign Out", async () => {
    const vault = new SignerVault("npubcash-signer-vault-test")

    await vault.saveNip07(PUBLIC_KEY)
    expect(await vault.getActive()).toEqual({
      mode: "nip07",
      expectedPublicKey: PUBLIC_KEY,
      version: 1,
    })

    await vault.removeActive()
    expect(await vault.getActive()).toBeNull()
    vault.close()
  })
})
