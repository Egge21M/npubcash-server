import { describe, expect, test } from "bun:test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure"
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44"

import {
  createNip46Pairing,
  Nip46Session,
  reconnectNip46,
  type Nip46RelayAdapter,
  type Nip46RelayEvent,
  type Nip46Subscription,
} from "./nip46-session"

const INITIAL_RELAY = "wss://relay.example.com/"
const SWITCHED_RELAY = "wss://signer.example.com/"
const RECIPIENT_PUBLIC_KEY = "c".repeat(64)

class FakeRelayAdapter implements Nip46RelayAdapter {
  subscriptions: Array<{
    relays: string[]
    authors?: string[]
    recipient: string
    onEvent(event: Nip46RelayEvent): void
    closed: boolean
  }> = []
  published: Array<{ relays: string[]; event: Nip46RelayEvent }> = []
  closedRelaySets: string[][] = []
  destroyed = false
  failSubscriptionClose = false
  failRelayClose = false
  failDestroy = false

  subscribe(
    relays: string[],
    filter: { authors?: string[]; recipient: string },
    onEvent: (event: Nip46RelayEvent) => void
  ): Nip46Subscription {
    const subscription = {
      relays: [...relays],
      authors: filter.authors,
      recipient: filter.recipient,
      onEvent,
      closed: false,
    }
    this.subscriptions.push(subscription)
    return {
      close: () => {
        subscription.closed = true
        if (this.failSubscriptionClose) {
          throw new Error("subscription close failed")
        }
      },
    }
  }

  async publish(relays: string[], event: Nip46RelayEvent): Promise<void> {
    this.published.push({ relays: [...relays], event })
  }

  close(relays: string[]): void {
    this.closedRelaySets.push([...relays])
    if (this.failRelayClose) throw new Error("relay close failed")
  }

  destroy(): void {
    this.destroyed = true
    if (this.failDestroy) throw new Error("relay destroy failed")
  }

  deliver(event: Nip46RelayEvent): void {
    for (const subscription of this.subscriptions) {
      if (
        !subscription.closed &&
        event.tags.some(
          ([name, value]) => name === "p" && value === subscription.recipient
        ) &&
        (!subscription.authors || subscription.authors.includes(event.pubkey))
      ) {
        subscription.onEvent(event)
      }
    }
  }
}

function responseEvent(
  remoteSecretKey: Uint8Array,
  clientPublicKey: string,
  response: { id: string; result?: string; error?: string }
): Nip46RelayEvent {
  const conversationKey = getConversationKey(remoteSecretKey, clientPublicKey)
  return finalizeEvent(
    {
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", clientPublicKey]],
      content: encrypt(JSON.stringify(response), conversationKey),
    },
    remoteSecretKey
  )
}

function readRequest(
  published: Nip46RelayEvent,
  remoteSecretKey: Uint8Array
): { id: string; method: string; params: string[] } {
  return JSON.parse(
    decrypt(
      published.content,
      getConversationKey(remoteSecretKey, published.pubkey)
    )
  )
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("NIP-46 session", () => {
  test("signs an npub.cash authentication event through sign_event", async () => {
    const relay = new FakeRelayAdapter()
    const clientSecretKey = generateSecretKey()
    const remoteSecretKey = generateSecretKey()
    const recipientSecretKey = generateSecretKey()
    const session = new Nip46Session(
      clientSecretKey,
      getPublicKey(remoteSecretKey),
      [INITIAL_RELAY],
      { relay, timeoutMs: 1_000 }
    )
    const template = {
      kind: 27235,
      created_at: 1_700_000_000,
      tags: [
        ["u", "https://npub.cash/api/v2/auth/nip98"],
        ["method", "GET"],
      ],
      content: "",
    }

    const signedPromise = session.signEvent(template)
    await settle()
    const request = readRequest(relay.published.at(-1)!.event, remoteSecretKey)
    expect(request.method).toBe("sign_event")
    expect(JSON.parse(request.params[0]!)).toEqual(template)

    const signed = finalizeEvent(template, recipientSecretKey)
    relay.deliver(
      responseEvent(remoteSecretKey, session.clientPublicKey, {
        id: request.id,
        result: JSON.stringify(signed),
      })
    )

    expect(await signedPromise).toEqual(JSON.parse(JSON.stringify(signed)))
    await session.close()
  })

  test("distinguishes a spoofed one-time response without selecting its author", async () => {
    const relay = new FakeRelayAdapter()
    const spoofingSecretKey = generateSecretKey()
    const pairing = createNip46Pairing({
      relays: [INITIAL_RELAY],
      relay,
      timeoutMs: 20,
    })
    const establishment = pairing.establish()

    relay.deliver(
      responseEvent(spoofingSecretKey, pairing.clientPublicKey, {
        id: "spoofed-connect",
        result: "wrong-one-time-secret",
      })
    )

    await expect(establishment).rejects.toThrow("did not match")
    expect(relay.published).toHaveLength(0)
    expect(relay.destroyed).toBe(true)
  })

  test("keeps client, remote-signer, and Recipient keys distinct and persists only after verification", async () => {
    const relay = new FakeRelayAdapter()
    const remoteSecretKey = generateSecretKey()
    const remoteSignerPublicKey = getPublicKey(remoteSecretKey)
    const pairing = createNip46Pairing({
      relays: [INITIAL_RELAY],
      relay,
      timeoutMs: 1_000,
    })

    expect(pairing.uri).toStartWith(
      `nostrconnect://${pairing.clientPublicKey}?`
    )
    expect(pairing.clientPublicKey).not.toBe(remoteSignerPublicKey)
    expect(pairing.clientPublicKey).not.toBe(RECIPIENT_PUBLIC_KEY)
    const pairingSecret = new URL(pairing.uri).searchParams.get("secret")!

    const establishedPromise = pairing.establish()
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: "connect-response",
        result: pairingSecret,
      })
    )
    await settle()

    const switchRequest = readRequest(
      relay.published.at(-1)!.event,
      remoteSecretKey
    )
    expect(switchRequest.method).toBe("switch_relays")
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: switchRequest.id,
        result: "null",
      })
    )
    await settle()

    const publicKeyRequest = readRequest(
      relay.published.at(-1)!.event,
      remoteSecretKey
    )
    expect(publicKeyRequest.method).toBe("get_public_key")
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: publicKeyRequest.id,
        result: RECIPIENT_PUBLIC_KEY,
      })
    )

    const established = await establishedPromise
    expect(established.record).toMatchObject({
      mode: "nip46",
      clientPublicKey: pairing.clientPublicKey,
      remoteSignerPublicKey,
      expectedPublicKey: RECIPIENT_PUBLIC_KEY,
      relays: [INITIAL_RELAY],
    })
    expect(JSON.stringify(established.record)).not.toContain(pairingSecret)
    await established.session.close()
  })

  test("keeps the same request pending across auth_url and accepts only the correlated follow-up", async () => {
    const relay = new FakeRelayAdapter()
    const remoteSecretKey = generateSecretKey()
    const authChallenges: Array<{ requestId: string; url: string }> = []
    const pairing = createNip46Pairing({
      relays: [INITIAL_RELAY],
      relay,
      timeoutMs: 1_000,
      onAuthorization: (challenge) => authChallenges.push(challenge),
    })

    const establishedPromise = pairing.establish()
    const pairingSecret = new URL(pairing.uri).searchParams.get("secret")!
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: "connect-response",
        result: pairingSecret,
      })
    )
    await settle()
    const request = readRequest(relay.published.at(-1)!.event, remoteSecretKey)

    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: request.id,
        result: "auth_url",
        error: "https://signer.example.com/authorize",
      })
    )
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: "spoofed-id",
        result: "null",
      })
    )
    await settle()
    expect(authChallenges).toEqual([
      {
        requestId: request.id,
        url: "https://signer.example.com/authorize",
      },
    ])
    expect(relay.published).toHaveLength(1)

    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: request.id,
        result: "null",
      })
    )
    await settle()
    const publicKeyRequest = readRequest(
      relay.published.at(-1)!.event,
      remoteSecretKey
    )
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: publicKeyRequest.id,
        result: RECIPIENT_PUBLIC_KEY,
      })
    )
    const established = await establishedPromise
    await established.session.close()
  })

  test("migrates to validated relays and closes the previous subscription", async () => {
    const relay = new FakeRelayAdapter()
    const remoteSecretKey = generateSecretKey()
    const pairing = createNip46Pairing({
      relays: [INITIAL_RELAY],
      relay,
      timeoutMs: 1_000,
    })
    const establishedPromise = pairing.establish()
    const pairingSecret = new URL(pairing.uri).searchParams.get("secret")!
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: "connect-response",
        result: pairingSecret,
      })
    )
    await settle()
    const switchRequest = readRequest(
      relay.published.at(-1)!.event,
      remoteSecretKey
    )
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: switchRequest.id,
        result: JSON.stringify([SWITCHED_RELAY]),
      })
    )
    await settle()
    expect(relay.subscriptions[0]?.closed).toBe(true)
    expect(relay.closedRelaySets).toContainEqual([INITIAL_RELAY])
    expect(relay.published.at(-1)?.relays).toEqual([SWITCHED_RELAY])

    const publicKeyRequest = readRequest(
      relay.published.at(-1)!.event,
      remoteSecretKey
    )
    relay.deliver(
      responseEvent(remoteSecretKey, pairing.clientPublicKey, {
        id: publicKeyRequest.id,
        result: RECIPIENT_PUBLIC_KEY,
      })
    )
    const established = await establishedPromise
    expect(established.record.relays).toEqual([SWITCHED_RELAY])
    await established.session.close()
  })

  test("cancellation tears down subscriptions and erases incomplete pairing material", async () => {
    const relay = new FakeRelayAdapter()
    const pairing = createNip46Pairing({
      relays: [INITIAL_RELAY],
      relay,
      timeoutMs: 1_000,
    })
    const secret = new URL(pairing.uri).searchParams.get("secret")!
    const establishment = pairing.establish()

    await pairing.cancel()

    await expect(establishment).rejects.toThrow("canceled")
    expect(
      relay.subscriptions.every((subscription) => subscription.closed)
    ).toBe(true)
    expect(relay.destroyed).toBe(true)
    expect(pairing.uri).not.toContain(secret)
  })

  test("reconnect verifies the exact persisted Recipient key before returning", async () => {
    const relay = new FakeRelayAdapter()
    const remoteSecretKey = generateSecretKey()
    const clientSecretKey = generateSecretKey()
    const record = {
      version: 1 as const,
      protocolVersion: 1 as const,
      mode: "nip46" as const,
      clientSecretKey: Buffer.from(clientSecretKey).toString("hex"),
      clientPublicKey: getPublicKey(clientSecretKey),
      remoteSignerPublicKey: getPublicKey(remoteSecretKey),
      expectedPublicKey: RECIPIENT_PUBLIC_KEY,
      relays: [INITIAL_RELAY],
      requestedPermissions: ["sign_event"],
      knownPermissions: ["sign_event"],
    }

    const restoredPromise = reconnectNip46(record, {
      relay,
      timeoutMs: 1_000,
    })
    await settle()
    let request = readRequest(relay.published.at(-1)!.event, remoteSecretKey)
    relay.deliver(
      responseEvent(remoteSecretKey, record.clientPublicKey, {
        id: request.id,
        result: "null",
      })
    )
    await settle()
    request = readRequest(relay.published.at(-1)!.event, remoteSecretKey)
    relay.deliver(
      responseEvent(remoteSecretKey, record.clientPublicKey, {
        id: request.id,
        result: "d".repeat(64),
      })
    )

    await expect(restoredPromise).rejects.toThrow("different Public Key")
    expect(relay.destroyed).toBe(true)
  })

  test("aborting reconnect rejects pending requests and destroys the transport", async () => {
    const relay = new FakeRelayAdapter()
    const remoteSecretKey = generateSecretKey()
    const clientSecretKey = generateSecretKey()
    const controller = new AbortController()
    const record = {
      version: 1 as const,
      protocolVersion: 1 as const,
      mode: "nip46" as const,
      clientSecretKey: Buffer.from(clientSecretKey).toString("hex"),
      clientPublicKey: getPublicKey(clientSecretKey),
      remoteSignerPublicKey: getPublicKey(remoteSecretKey),
      expectedPublicKey: RECIPIENT_PUBLIC_KEY,
      relays: [INITIAL_RELAY],
      requestedPermissions: ["sign_event"],
      knownPermissions: ["sign_event"],
    }

    const restored = reconnectNip46(record, {
      relay,
      signal: controller.signal,
      timeoutMs: 1_000,
    })
    await settle()
    controller.abort()

    await expect(restored).rejects.toThrow("canceled")
    expect(relay.destroyed).toBe(true)
    expect(
      relay.subscriptions.every((subscription) => subscription.closed)
    ).toBe(true)
  })

  test("clears the client key even when every transport cleanup step fails", async () => {
    const relay = new FakeRelayAdapter()
    const clientSecretKey = generateSecretKey()
    const remoteSecretKey = generateSecretKey()
    const session = new Nip46Session(
      clientSecretKey,
      getPublicKey(remoteSecretKey),
      [INITIAL_RELAY],
      { relay }
    )
    clientSecretKey.fill(0)
    relay.failSubscriptionClose = true
    relay.failRelayClose = true
    relay.failDestroy = true

    await session.close()

    expect(relay.destroyed).toBe(true)
    expect(() => session.exportClientSecretKey()).toThrow("unavailable")
  })
})
