import { describe, expect, test } from "bun:test"

import {
  CorruptSignerEnvelopeError,
  decryptDirectNsecEnvelope,
  DirectNsecUnlockError,
  encryptDirectNsecEnvelope,
  MAXIMUM_PBKDF2_ITERATIONS,
  MINIMUM_PBKDF2_ITERATIONS,
  readDirectNsecEnvelope,
  UnsupportedSignerEnvelopeError,
} from "./signer-envelope"

const SECRET_KEY = Uint8Array.from({ length: 32 }, (_, index) => index)
const PASSPHRASE = "correct horse battery staple"

describe("direct-nsec signer envelope", () => {
  test("matches the known PBKDF2-SHA-256 and AES-256-GCM answer", async () => {
    const envelope = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE, {
      iterations: MINIMUM_PBKDF2_ITERATIONS,
      salt: Uint8Array.from({ length: 16 }, (_, index) => index),
      iv: Uint8Array.from({ length: 12 }, (_, index) => index + 16),
    })

    expect(envelope).toEqual({
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: MINIMUM_PBKDF2_ITERATIONS,
        salt: "AAECAwQFBgcICQoLDA0ODw==",
      },
      cipher: {
        name: "AES-GCM",
        iv: "EBESExQVFhcYGRob",
      },
      ciphertext:
        "Ge63+rSXbJ7PiubViQ2Y4fNeqLwnJNVX7xY/+Q8gd/B6nb7PYmg4Rpm8uw7pAPVP",
    })
    expect(await decryptDirectNsecEnvelope(envelope, PASSPHRASE)).toEqual(
      SECRET_KEY
    )
  })

  test("wrong passphrases fail without changing the envelope", async () => {
    const envelope = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE, {
      iterations: MINIMUM_PBKDF2_ITERATIONS,
      salt: new Uint8Array(16),
      iv: new Uint8Array(12),
    })
    const before = structuredClone(envelope)

    expect(
      decryptDirectNsecEnvelope(envelope, "incorrect passphrase")
    ).rejects.toBeInstanceOf(DirectNsecUnlockError)
    expect(envelope).toEqual(before)
  })

  test("refuses unsupported envelope versions", async () => {
    const envelope = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE, {
      iterations: MINIMUM_PBKDF2_ITERATIONS,
      salt: new Uint8Array(16),
      iv: new Uint8Array(12),
    })

    expect(
      decryptDirectNsecEnvelope({ ...envelope, version: 2 }, PASSPHRASE)
    ).rejects.toBeInstanceOf(UnsupportedSignerEnvelopeError)
  })

  test("generates a unique salt and nonce for every envelope", async () => {
    const first = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE)
    const second = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE)

    expect(first.kdf.iterations).toBeGreaterThanOrEqual(210_000)
    expect(second.kdf.iterations).toBeGreaterThanOrEqual(210_000)
    expect(second.kdf.salt).not.toBe(first.kdf.salt)
    expect(second.cipher.iv).not.toBe(first.cipher.iv)
    expect(second.ciphertext).not.toBe(first.ciphertext)
  })

  test("rejects persisted work factors outside the supported range", async () => {
    const envelope = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE, {
      iterations: MINIMUM_PBKDF2_ITERATIONS,
      salt: new Uint8Array(16),
      iv: new Uint8Array(12),
    })

    await expect(
      decryptDirectNsecEnvelope(
        {
          ...envelope,
          kdf: {
            ...envelope.kdf,
            iterations: MINIMUM_PBKDF2_ITERATIONS - 1,
          },
        },
        PASSPHRASE
      )
    ).rejects.toBeInstanceOf(CorruptSignerEnvelopeError)
    await expect(
      decryptDirectNsecEnvelope(
        {
          ...envelope,
          kdf: {
            ...envelope.kdf,
            iterations: MAXIMUM_PBKDF2_ITERATIONS + 1,
          },
        },
        PASSPHRASE
      )
    ).rejects.toBeInstanceOf(CorruptSignerEnvelopeError)
  })

  test("rejects oversized encoded fields before cryptographic work", async () => {
    const envelope = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE, {
      iterations: MINIMUM_PBKDF2_ITERATIONS,
      salt: new Uint8Array(16),
      iv: new Uint8Array(12),
    })

    expect(() =>
      readDirectNsecEnvelope({
        ...envelope,
        kdf: { ...envelope.kdf, salt: "A".repeat(24_000) },
      })
    ).toThrow(CorruptSignerEnvelopeError)
    expect(() =>
      readDirectNsecEnvelope({
        ...envelope,
        ciphertext: "A".repeat(64_000),
      })
    ).toThrow(CorruptSignerEnvelopeError)
  })

  test("reports authenticated corruption without blaming the passphrase", async () => {
    const envelope = await encryptDirectNsecEnvelope(SECRET_KEY, PASSPHRASE, {
      iterations: MINIMUM_PBKDF2_ITERATIONS,
      salt: new Uint8Array(16),
      iv: new Uint8Array(12),
    })
    const tampered = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -2)}AA`,
    }

    await expect(
      decryptDirectNsecEnvelope(tampered, PASSPHRASE)
    ).rejects.toEqual(
      new DirectNsecUnlockError(
        "The passphrase or encrypted signer record could not be verified."
      )
    )
  })
})
