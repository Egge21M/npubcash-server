import { finalizeEvent, getPublicKey } from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"

import type { Nip07Event } from "./nip07"

export class DirectNsecInvalidError extends Error {
  constructor() {
    super("Enter a valid nsec Identity Secret.")
    this.name = "DirectNsecInvalidError"
  }
}

export class DirectNsecDestroyedError extends Error {
  constructor() {
    super("The direct signer is no longer available.")
    this.name = "DirectNsecDestroyedError"
  }
}

export function decodeDirectNsec(value: string): Uint8Array {
  try {
    const decoded = nip19.decode(value.trim())
    if (decoded.type !== "nsec" || decoded.data.length !== 32) {
      throw new DirectNsecInvalidError()
    }
    return Uint8Array.from(decoded.data)
  } catch (error) {
    if (error instanceof DirectNsecInvalidError) throw error
    throw new DirectNsecInvalidError()
  }
}

export class DirectNsecSignerAdapter {
  readonly publicKey: string
  private secretKey: Uint8Array | null

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) throw new DirectNsecInvalidError()

    const runtimeKey = Uint8Array.from(secretKey)
    try {
      this.publicKey = getPublicKey(runtimeKey)
      this.secretKey = runtimeKey
    } catch {
      runtimeKey.fill(0)
      throw new DirectNsecInvalidError()
    }
  }

  signEvent(event: Nip07Event): Nip07Event {
    if (!this.secretKey) throw new DirectNsecDestroyedError()

    return finalizeEvent(
      {
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
      },
      this.secretKey
    )
  }

  destroy(): void {
    this.secretKey?.fill(0)
    this.secretKey = null
  }
}

export function openDirectNsec(value: string): DirectNsecSignerAdapter {
  const secretKey = decodeDirectNsec(value)
  try {
    return new DirectNsecSignerAdapter(secretKey)
  } finally {
    secretKey.fill(0)
  }
}
