import { NostrConnect } from "nostr-tools/kinds"
import { createNostrConnectURI } from "nostr-tools/nip46"
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44"
import { SimplePool } from "nostr-tools/pool"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure"

import { normalizePublicKey, type Nip07Event } from "./nip07"
import { InvalidNip46RelayError, normalizeNip46Relay } from "./nip46-relay"

export const NIP46_PROTOCOL_VERSION = 1
export const DEFAULT_NIP46_TIMEOUT_MS = 60_000
export const DEFAULT_NIP46_LOGOUT_TIMEOUT_MS = 3_000
export const NIP46_REQUESTED_PERMISSIONS = [
  "sign_event:27235",
  "nip44_encrypt",
  "nip44_decrypt",
] as const

export interface Nip46ConnectionRecord {
  version: 1
  protocolVersion: 1
  mode: "nip46"
  clientSecretKey: string
  clientPublicKey: string
  remoteSignerPublicKey: string
  expectedPublicKey: string
  relays: string[]
  requestedPermissions: string[]
  knownPermissions: string[]
}

export interface Nip46RelayEvent {
  kind: number
  created_at: number
  tags: string[][]
  content: string
  pubkey: string
  id: string
  sig: string
}

export interface Nip46Subscription {
  close(reason?: string): void | Promise<void>
}

export interface Nip46RelayAdapter {
  subscribe(
    relays: string[],
    filter: { authors?: string[]; recipient: string },
    onEvent: (event: Nip46RelayEvent) => void
  ): Nip46Subscription
  publish(relays: string[], event: Nip46RelayEvent): Promise<void>
  close(relays: string[]): void
  destroy(): void
}

export interface Nip46AuthorizationChallenge {
  requestId: string
  url: string
}

interface Nip46SessionOptions {
  relay?: Nip46RelayAdapter
  timeoutMs?: number
  onAuthorization?: (challenge: Nip46AuthorizationChallenge) => void
  signal?: AbortSignal
}

interface Nip46PairingOptions extends Nip46SessionOptions {
  relays: string[]
  requestedPermissions?: string[]
  name?: string
  url?: string
}

export class Nip46CanceledError extends Error {
  constructor() {
    super("Remote signer pairing was canceled.")
    this.name = "Nip46CanceledError"
  }
}

export class Nip46TimeoutError extends Error {
  constructor(operation: string) {
    super(`The remote signer did not respond before ${operation} timed out.`)
    this.name = "Nip46TimeoutError"
  }
}

export class Nip46PublicKeyMismatchError extends Error {
  constructor() {
    super("The remote signer reported a different Public Key.")
    this.name = "Nip46PublicKeyMismatchError"
  }
}

export class Nip46ProtocolError extends Error {
  constructor(message = "The remote signer returned a malformed response.") {
    super(message)
    this.name = "Nip46ProtocolError"
  }
}

export class Nip46SpoofedResponseError extends Error {
  constructor() {
    super("A remote signer response did not match the one-time pairing secret.")
    this.name = "Nip46SpoofedResponseError"
  }
}

export class Nip46UnavailableError extends Error {
  constructor(message = "The remote signer is unavailable.") {
    super(message)
    this.name = "Nip46UnavailableError"
  }
}

type PendingRequest = {
  method: string
  resolve(value: string): void
  reject(error: unknown): void
  timer: ReturnType<typeof setTimeout>
}

type PairingResult = {
  remoteSignerPublicKey: string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Nip46ProtocolError()
  return Uint8Array.from(value.match(/.{2}/g)!, (byte) => parseInt(byte, 16))
}

function randomToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

function normalizeRelay(value: string): string {
  try {
    return normalizeNip46Relay(value)
  } catch (error) {
    throw new Nip46ProtocolError(
      error instanceof InvalidNip46RelayError && error.reason === "insecure"
        ? "The remote signer returned an insecure relay."
        : "The remote signer returned an invalid relay."
    )
  }
}

function normalizeRelays(values: string[]): string[] {
  if (values.length === 0) {
    throw new Nip46ProtocolError(
      "At least one remote signer relay is required."
    )
  }
  return [...new Set(values.map(normalizeRelay))]
}

function readResponse(value: unknown): {
  id: string
  result?: string
  error?: string
} {
  if (!value || typeof value !== "object") throw new Nip46ProtocolError()
  const response = value as Record<string, unknown>
  if (
    typeof response.id !== "string" ||
    (response.result !== undefined && typeof response.result !== "string") ||
    (response.error !== undefined && typeof response.error !== "string")
  ) {
    throw new Nip46ProtocolError()
  }
  return {
    id: response.id,
    result: response.result,
    error: response.error,
  }
}

function readRelaySwitch(value: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Nip46ProtocolError("The remote signer returned invalid relays.")
  }
  if (parsed === null) return null
  if (
    !Array.isArray(parsed) ||
    !parsed.every((relay) => typeof relay === "string")
  ) {
    throw new Nip46ProtocolError("The remote signer returned invalid relays.")
  }
  return normalizeRelays(parsed)
}

function readAuthorizationUrl(value: string | undefined): string {
  if (!value) throw new Nip46ProtocolError("The authorization URL is missing.")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Nip46ProtocolError("The authorization URL is invalid.")
  }
  if (url.protocol !== "https:") {
    throw new Nip46ProtocolError("The authorization URL must use HTTPS.")
  }
  return url.toString()
}

function readSignedEvent(value: string): Nip07Event {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Nip46ProtocolError("The remote signer returned an invalid event.")
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Nip46ProtocolError("The remote signer returned an invalid event.")
  }
  const event = parsed as Record<string, unknown>
  if (
    typeof event.kind !== "number" ||
    typeof event.created_at !== "number" ||
    typeof event.content !== "string" ||
    !Array.isArray(event.tags) ||
    !event.tags.every(
      (tag) =>
        Array.isArray(tag) && tag.every((value) => typeof value === "string")
    ) ||
    typeof event.pubkey !== "string" ||
    typeof event.id !== "string" ||
    typeof event.sig !== "string"
  ) {
    throw new Nip46ProtocolError("The remote signer returned an invalid event.")
  }
  return parsed as Nip07Event
}

export class SimplePoolNip46RelayAdapter implements Nip46RelayAdapter {
  private readonly pool = new SimplePool({ enableReconnect: true })

  subscribe(
    relays: string[],
    filter: { authors?: string[]; recipient: string },
    onEvent: (event: Nip46RelayEvent) => void
  ): Nip46Subscription {
    return this.pool.subscribe(
      relays,
      {
        kinds: [NostrConnect],
        authors: filter.authors,
        "#p": [filter.recipient],
      },
      { onevent: onEvent }
    )
  }

  async publish(relays: string[], event: Nip46RelayEvent): Promise<void> {
    try {
      await Promise.any(this.pool.publish(relays, event))
    } catch (error) {
      throw new Nip46UnavailableError(
        error instanceof Error ? error.message : undefined
      )
    }
  }

  close(relays: string[]): void {
    this.pool.close(relays)
  }

  destroy(): void {
    this.pool.destroy()
  }
}

export class Nip46Session {
  readonly clientPublicKey: string
  private secretKey: Uint8Array | null
  private remoteSignerPublicKey: string | null
  private relays: string[]
  private readonly relay: Nip46RelayAdapter
  private readonly timeoutMs: number
  private readonly onAuthorization?: Nip46SessionOptions["onAuthorization"]
  private subscription: Nip46Subscription | null = null
  private pending = new Map<string, PendingRequest>()
  private pairingFailure: "malformed" | "spoofed" | null = null
  private closed = false

  constructor(
    clientSecretKey: Uint8Array,
    remoteSignerPublicKey: string | null,
    relays: string[],
    options: Nip46SessionOptions = {}
  ) {
    this.secretKey = Uint8Array.from(clientSecretKey)
    this.clientPublicKey = getPublicKey(this.secretKey)
    this.remoteSignerPublicKey = remoteSignerPublicKey
      ? normalizePublicKey(remoteSignerPublicKey)
      : null
    this.relays = normalizeRelays(relays)
    this.relay = options.relay ?? new SimplePoolNip46RelayAdapter()
    this.timeoutMs = options.timeoutMs ?? DEFAULT_NIP46_TIMEOUT_MS
    this.onAuthorization = options.onAuthorization
    this.subscribe()
  }

  get activeRelays(): string[] {
    return [...this.relays]
  }

  get remotePublicKey(): string | null {
    return this.remoteSignerPublicKey
  }

  acceptPairingSecret(secret: string): Promise<PairingResult> {
    if (this.remoteSignerPublicKey) {
      return Promise.reject(new Nip46ProtocolError())
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pairingWaiter = null
        reject(
          this.pairingFailure === "spoofed"
            ? new Nip46SpoofedResponseError()
            : this.pairingFailure === "malformed"
              ? new Nip46ProtocolError()
              : new Nip46TimeoutError("pairing")
        )
      }, this.timeoutMs)
      this.pairingWaiter = {
        secret,
        resolve: (remoteSignerPublicKey) => {
          clearTimeout(timer)
          this.pairingWaiter = null
          resolve({ remoteSignerPublicKey })
        },
        reject: (error) => {
          clearTimeout(timer)
          this.pairingWaiter = null
          reject(error)
        },
      }
    })
  }

  private pairingWaiter: {
    secret: string
    resolve(remoteSignerPublicKey: string): void
    reject(error: unknown): void
  } | null = null

  async request(
    method: string,
    params: string[] = [],
    timeoutMs = this.timeoutMs
  ): Promise<string> {
    if (this.closed || !this.secretKey || !this.remoteSignerPublicKey) {
      throw new Nip46UnavailableError()
    }
    const id = randomToken()
    const conversationKey = getConversationKey(
      this.secretKey,
      this.remoteSignerPublicKey
    )
    const event = finalizeEvent(
      {
        kind: NostrConnect,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", this.remoteSignerPublicKey]],
        content: encrypt(
          JSON.stringify({ id, method, params }),
          conversationKey
        ),
      },
      this.secretKey
    )

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Nip46TimeoutError(method))
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      void this.relay.publish(this.relays, event).catch((error) => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  async refreshRelays(): Promise<void> {
    const response = readRelaySwitch(await this.request("switch_relays"))
    if (!response || response.join("\n") === this.relays.join("\n")) return

    const previousRelays = this.relays
    const previousSubscription = this.subscription
    this.relays = response
    this.subscription = null
    this.subscribe()
    await previousSubscription?.close("NIP-46 relay migration")
    this.relay.close(previousRelays)
  }

  async verifiedPublicKey(expectedPublicKey?: string): Promise<string> {
    const actualPublicKey = normalizePublicKey(
      await this.request("get_public_key")
    )
    if (
      expectedPublicKey &&
      actualPublicKey !== normalizePublicKey(expectedPublicKey)
    ) {
      throw new Nip46PublicKeyMismatchError()
    }
    return actualPublicKey
  }

  async signEvent(event: Nip07Event): Promise<Nip07Event> {
    return readSignedEvent(
      await this.request("sign_event", [JSON.stringify(event)])
    )
  }

  async logout(timeoutMs = DEFAULT_NIP46_LOGOUT_TIMEOUT_MS): Promise<void> {
    const result = await this.request("logout", [], timeoutMs)
    if (result !== "ack") throw new Nip46ProtocolError()
  }

  exportClientSecretKey(): string {
    if (!this.secretKey) throw new Nip46UnavailableError()
    return bytesToHex(this.secretKey)
  }

  async close(reason: unknown = new Nip46CanceledError()): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.pairingWaiter?.reject(reason)
    this.pairingWaiter = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(reason)
    }
    this.pending.clear()
    const subscription = this.subscription
    this.subscription = null
    try {
      await subscription?.close("NIP-46 session closed")
    } catch {
      // Continue destroying the transport and key even when a subscription
      // implementation reports a close failure.
    }
    try {
      this.relay.close(this.relays)
    } catch {
      // Relay cleanup is best effort; destroying the pool and key is mandatory.
    }
    try {
      this.relay.destroy()
    } catch {
      // The connection secret must still be cleared if pool disposal fails.
    } finally {
      this.secretKey?.fill(0)
      this.secretKey = null
    }
  }

  private subscribe(): void {
    if (this.closed) return
    this.subscription = this.relay.subscribe(
      this.relays,
      {
        authors: this.remoteSignerPublicKey
          ? [this.remoteSignerPublicKey]
          : undefined,
        recipient: this.clientPublicKey,
      },
      (event) => this.receive(event)
    )
  }

  private receive(event: Nip46RelayEvent): void {
    if (this.closed || !this.secretKey) return
    if (
      this.remoteSignerPublicKey &&
      event.pubkey !== this.remoteSignerPublicKey
    ) {
      return
    }

    let response: ReturnType<typeof readResponse>
    try {
      response = readResponse(
        JSON.parse(
          decrypt(
            event.content,
            getConversationKey(this.secretKey, event.pubkey)
          )
        )
      )
    } catch {
      if (!this.remoteSignerPublicKey && this.pairingWaiter) {
        this.pairingFailure = "malformed"
      }
      return
    }

    if (!this.remoteSignerPublicKey) {
      if (
        !this.pairingWaiter ||
        response.result !== this.pairingWaiter.secret
      ) {
        if (this.pairingWaiter) this.pairingFailure = "spoofed"
        return
      }
      this.remoteSignerPublicKey = normalizePublicKey(event.pubkey)
      const previousSubscription = this.subscription
      this.subscription = null
      this.subscribe()
      void previousSubscription?.close("NIP-46 signer discovered")
      this.pairingWaiter.resolve(this.remoteSignerPublicKey)
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) return
    if (response.result === "auth_url") {
      try {
        this.onAuthorization?.({
          requestId: response.id,
          url: readAuthorizationUrl(response.error),
        })
      } catch (error) {
        clearTimeout(pending.timer)
        this.pending.delete(response.id)
        pending.reject(error)
      }
      return
    }

    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    if (response.error !== undefined) pending.reject(new Error(response.error))
    else if (response.result === undefined)
      pending.reject(new Nip46ProtocolError())
    else pending.resolve(response.result)
  }
}

export interface Nip46EstablishedConnection {
  session: Nip46Session
  record: Nip46ConnectionRecord
}

export interface Nip46Pairing {
  readonly clientPublicKey: string
  readonly uri: string
  establish(): Promise<Nip46EstablishedConnection>
  cancel(): Promise<void>
}

export function createNip46Pairing(options: Nip46PairingOptions): Nip46Pairing {
  const clientSecretKey = generateSecretKey()
  let pairingSecret = randomToken()
  const relays = normalizeRelays(options.relays)
  const requestedPermissions = [
    ...(options.requestedPermissions ?? NIP46_REQUESTED_PERMISSIONS),
  ]
  const session = new Nip46Session(clientSecretKey, null, relays, options)
  clientSecretKey.fill(0)
  let uri = createNostrConnectURI({
    clientPubkey: session.clientPublicKey,
    relays,
    secret: pairingSecret,
    perms: requestedPermissions,
    name: options.name ?? "npub.cash Wallet",
    url: options.url,
  })
  let establishment: Promise<Nip46EstablishedConnection> | null = null

  const establish = () => {
    establishment ??= (async () => {
      try {
        await session.acceptPairingSecret(pairingSecret)
        pairingSecret = ""
        uri = ""
        await session.refreshRelays()
        const expectedPublicKey = await session.verifiedPublicKey()
        const remoteSignerPublicKey = session.remotePublicKey
        if (!remoteSignerPublicKey) throw new Nip46ProtocolError()
        const record: Nip46ConnectionRecord = {
          version: 1,
          protocolVersion: NIP46_PROTOCOL_VERSION,
          mode: "nip46",
          clientSecretKey: session.exportClientSecretKey(),
          clientPublicKey: session.clientPublicKey,
          remoteSignerPublicKey,
          expectedPublicKey,
          relays: session.activeRelays,
          requestedPermissions,
          knownPermissions: [...requestedPermissions],
        }
        return { session, record }
      } catch (error) {
        pairingSecret = ""
        uri = ""
        await session.close(error)
        throw error
      }
    })()
    return establishment
  }

  return {
    clientPublicKey: session.clientPublicKey,
    get uri() {
      return uri
    },
    establish,
    async cancel() {
      pairingSecret = ""
      uri = ""
      await session.close(new Nip46CanceledError())
    },
  }
}

export async function reconnectNip46(
  record: Nip46ConnectionRecord,
  options: Nip46SessionOptions = {}
): Promise<Nip46EstablishedConnection> {
  const secretKey = hexToBytes(record.clientSecretKey)
  if (getPublicKey(secretKey) !== normalizePublicKey(record.clientPublicKey)) {
    secretKey.fill(0)
    throw new Nip46ProtocolError("The saved client connection key is damaged.")
  }
  const session = new Nip46Session(
    secretKey,
    record.remoteSignerPublicKey,
    record.relays,
    options
  )
  secretKey.fill(0)
  const abort = () => void session.close(new Nip46CanceledError())
  if (options.signal?.aborted) abort()
  options.signal?.addEventListener("abort", abort, { once: true })
  try {
    if (options.signal?.aborted) throw new Nip46CanceledError()
    await session.refreshRelays()
    await session.verifiedPublicKey(record.expectedPublicKey)
    if (options.signal?.aborted) throw new Nip46CanceledError()
    return {
      session,
      record: {
        ...record,
        relays: session.activeRelays,
      },
    }
  } catch (error) {
    await session.close(error)
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abort)
  }
}
