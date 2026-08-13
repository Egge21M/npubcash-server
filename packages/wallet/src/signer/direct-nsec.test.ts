import { describe, expect, test } from "bun:test"

import { DirectNsecInvalidError, openDirectNsec } from "./direct-nsec"

const NSEC_ONE =
  "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl"

describe("openDirectNsec", () => {
  test("derives the known secp256k1 Public Key for secret key one", () => {
    const signer = openDirectNsec(NSEC_ONE)

    expect(signer.publicKey).toBe(
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    )

    signer.destroy()
  })

  test("rejects values that are not valid nsec Identity Secrets", () => {
    expect(() => openDirectNsec("not-an-nsec")).toThrow(DirectNsecInvalidError)
  })
})
