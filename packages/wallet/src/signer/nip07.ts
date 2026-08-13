export interface Nip07Event {
  created_at: number
  kind: number
  tags: string[][]
  content: string
  pubkey?: string
  id?: string
  sig?: string
}

export interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(event: Nip07Event): Promise<Nip07Event>
}

export class Nip07UnavailableError extends Error {
  constructor() {
    super("No NIP-07 browser extension was found.")
    this.name = "Nip07UnavailableError"
  }
}

export class Nip07InvalidPublicKeyError extends Error {
  constructor() {
    super("The NIP-07 extension returned an invalid Public Key.")
    this.name = "Nip07InvalidPublicKeyError"
  }
}

export class Nip07PublicKeyMismatchError extends Error {
  constructor() {
    super("The NIP-07 extension is using a different Public Key.")
    this.name = "Nip07PublicKeyMismatchError"
  }
}

export function normalizePublicKey(value: string): string {
  const normalized = value.trim().toLowerCase()

  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Nip07InvalidPublicKeyError()
  }

  return normalized
}

export class Nip07SignerAdapter {
  private readonly provider: Nip07Provider

  constructor(provider: Nip07Provider) {
    this.provider = provider
  }

  async open(expectedPublicKey?: string): Promise<string> {
    const actualPublicKey = normalizePublicKey(
      await this.provider.getPublicKey()
    )

    if (
      expectedPublicKey &&
      actualPublicKey !== normalizePublicKey(expectedPublicKey)
    ) {
      throw new Nip07PublicKeyMismatchError()
    }

    return actualPublicKey
  }

  signEvent(event: Nip07Event): Promise<Nip07Event> {
    return this.provider.signEvent(event)
  }
}

declare global {
  interface Window {
    nostr?: Nip07Provider
  }
}

export function findNip07Provider(): Nip07Provider | null {
  return window.nostr ?? null
}
