const ENVELOPE_ADDITIONAL_DATA = new TextEncoder().encode(
  "npubcash:direct-nsec:v1"
)

export const MINIMUM_PBKDF2_ITERATIONS = 210_000
export const MAXIMUM_PBKDF2_ITERATIONS = 1_000_000

export interface DirectNsecEnvelopeV1 {
  version: 1
  kdf: {
    name: "PBKDF2"
    hash: "SHA-256"
    iterations: number
    salt: string
  }
  cipher: {
    name: "AES-GCM"
    iv: string
  }
  ciphertext: string
}

export interface DirectNsecEncryptionParameters {
  iterations: number
  salt: Uint8Array
  iv: Uint8Array
}

export class DirectNsecUnlockError extends Error {
  constructor(
    message = "The passphrase or encrypted signer record could not be verified."
  ) {
    super(message)
    this.name = "DirectNsecUnlockError"
  }
}

export class CorruptSignerEnvelopeError extends Error {
  constructor() {
    super("The encrypted signer record is damaged.")
    this.name = "CorruptSignerEnvelopeError"
  }
}

export class UnsupportedSignerEnvelopeError extends Error {
  constructor() {
    super("This encrypted signer record uses an unsupported version.")
    this.name = "UnsupportedSignerEnvelopeError"
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const owned = new Uint8Array(bytes.length)
  owned.set(bytes)
  return owned
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new CorruptSignerEnvelopeError()
  }
}

async function deriveEncryptionKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  )

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: ownedBytes(salt),
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  )
}

export async function calibratePbkdf2Iterations(
  targetMilliseconds = 250
): Promise<number> {
  const probeIterations = 50_000
  const startedAt = performance.now()
  await deriveEncryptionKey(
    "npubcash-pbkdf2-calibration",
    new Uint8Array(16),
    probeIterations,
    ["encrypt"]
  )
  const elapsed = Math.max(performance.now() - startedAt, 1)
  const estimate =
    Math.round((probeIterations * targetMilliseconds) / elapsed / 10_000) *
    10_000

  return Math.min(
    MAXIMUM_PBKDF2_ITERATIONS,
    Math.max(MINIMUM_PBKDF2_ITERATIONS, estimate)
  )
}

export async function encryptDirectNsecEnvelope(
  secretKey: Uint8Array,
  passphrase: string,
  parameters?: DirectNsecEncryptionParameters
): Promise<DirectNsecEnvelopeV1> {
  const salt = Uint8Array.from(
    parameters?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  )
  const iv = Uint8Array.from(
    parameters?.iv ?? crypto.getRandomValues(new Uint8Array(12))
  )
  const iterations =
    parameters?.iterations ?? (await calibratePbkdf2Iterations())
  const key = await deriveEncryptionKey(passphrase, salt, iterations, [
    "encrypt",
  ])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: ENVELOPE_ADDITIONAL_DATA },
      key,
      Uint8Array.from(secretKey)
    )
  )

  return {
    version: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: encodeBase64(salt),
    },
    cipher: { name: "AES-GCM", iv: encodeBase64(iv) },
    ciphertext: encodeBase64(ciphertext),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function readDirectNsecEnvelope(value: unknown): DirectNsecEnvelopeV1 {
  if (!isRecord(value)) throw new CorruptSignerEnvelopeError()
  if (value.version !== 1) throw new UnsupportedSignerEnvelopeError()
  if (!isRecord(value.kdf) || !isRecord(value.cipher)) {
    throw new CorruptSignerEnvelopeError()
  }
  if (
    value.kdf.name !== "PBKDF2" ||
    value.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(value.kdf.iterations) ||
    (value.kdf.iterations as number) < MINIMUM_PBKDF2_ITERATIONS ||
    (value.kdf.iterations as number) > MAXIMUM_PBKDF2_ITERATIONS ||
    typeof value.kdf.salt !== "string" ||
    value.kdf.salt.length !== 24 ||
    value.cipher.name !== "AES-GCM" ||
    typeof value.cipher.iv !== "string" ||
    value.cipher.iv.length !== 16 ||
    typeof value.ciphertext !== "string" ||
    value.ciphertext.length !== 64
  ) {
    throw new CorruptSignerEnvelopeError()
  }
  return value as unknown as DirectNsecEnvelopeV1
}

export async function decryptDirectNsecEnvelope(
  storedEnvelope: unknown,
  passphrase: string
): Promise<Uint8Array> {
  const envelope = readDirectNsecEnvelope(storedEnvelope)
  const salt = decodeBase64(envelope.kdf.salt)
  const iv = ownedBytes(decodeBase64(envelope.cipher.iv))
  const ciphertext = ownedBytes(decodeBase64(envelope.ciphertext))

  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length !== 48) {
    throw new CorruptSignerEnvelopeError()
  }

  try {
    const key = await deriveEncryptionKey(
      passphrase,
      salt,
      envelope.kdf.iterations,
      ["decrypt"]
    )
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: ENVELOPE_ADDITIONAL_DATA },
        key,
        ciphertext
      )
    )
    if (plaintext.length !== 32) {
      plaintext.fill(0)
      throw new CorruptSignerEnvelopeError()
    }
    return plaintext
  } catch (error) {
    if (error instanceof CorruptSignerEnvelopeError) throw error
    throw new DirectNsecUnlockError()
  }
}
