import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure"
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44"

const PUBLIC_KEY_A = "a".repeat(64)
const PUBLIC_KEY_B = "b".repeat(64)
const DIRECT_PUBLIC_KEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const DIRECT_NSEC =
  "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl"
const DIRECT_PASSPHRASE = "correct horse battery staple"
const OTHER_DIRECT_PUBLIC_KEY =
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
const OTHER_DIRECT_NSEC =
  "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqptcfk2"

type Nip46RelayTarget = {
  route: WebSocketRoute
  subscriptionId: string
}

class Nip46RelayFixture {
  readonly remoteSecretKey = generateSecretKey()
  readonly remoteSignerPublicKey = getPublicKey(this.remoteSecretKey)
  recipientPublicKey = "c".repeat(64)
  requestFailure: string | null = null
  logoutFailure: string | null = null
  authorizeGetPublicKey = false
  offline = false
  closedConnectionCount = 0
  openConnectionCount = 0
  private authorizationRequest: {
    target: Nip46RelayTarget
    clientPublicKey: string
    requestId: string
  } | null = null
  private connections: Array<{
    route: WebSocketRoute
    subscriptions: Map<string, Record<string, unknown>>
  }> = []

  async install(page: Page): Promise<void> {
    await page.routeWebSocket("wss://relay.example.com/", (route) => {
      route.onClose(() => {
        this.closedConnectionCount += 1
        this.openConnectionCount = Math.max(0, this.openConnectionCount - 1)
      })
      if (this.offline) {
        void route.close({ code: 1013, reason: "relay unavailable" })
        return
      }
      this.openConnectionCount += 1
      const connection = {
        route,
        subscriptions: new Map<string, Record<string, unknown>>(),
      }
      this.connections.push(connection)
      route.onMessage((raw) => {
        const message = JSON.parse(raw.toString()) as unknown[]
        if (message[0] === "REQ") {
          connection.subscriptions.set(
            String(message[1]),
            message[2] as Record<string, unknown>
          )
          return
        }
        if (message[0] === "CLOSE") {
          connection.subscriptions.delete(String(message[1]))
          return
        }
        if (message[0] !== "EVENT") return
        const event = message[1] as {
          id: string
          pubkey: string
          content: string
        }
        route.send(JSON.stringify(["OK", event.id, true, "accepted"]))
        void this.respondToRequest(route, connection.subscriptions, event)
      })
    })
  }

  async pair(uri: string): Promise<void> {
    const parsed = new URL(uri)
    const clientPublicKey = parsed.hostname
    const secret = parsed.searchParams.get("secret")!
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.sendResponse(clientPublicKey, `pairing-${attempt}`, secret)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  async goOffline(): Promise<void> {
    this.offline = true
    const connections = this.connections.splice(0)
    await Promise.all(
      connections.map(({ route }) =>
        route.close({ code: 1013, reason: "relay unavailable" })
      )
    )
  }

  async authorize(): Promise<void> {
    const pending = this.authorizationRequest
    if (!pending) throw new Error("No authorization request is pending")
    this.authorizationRequest = null
    await this.sendResponse(
      pending.clientPublicKey,
      pending.requestId,
      this.recipientPublicKey,
      undefined,
      pending.target
    )
  }

  private async respondToRequest(
    route: WebSocketRoute,
    subscriptions: Map<string, Record<string, unknown>>,
    event: { pubkey: string; content: string }
  ): Promise<void> {
    const request = JSON.parse(
      decrypt(
        event.content,
        getConversationKey(this.remoteSecretKey, event.pubkey)
      )
    ) as { id: string; method: string }
    const subscriptionId = this.subscriptionFor(subscriptions, event.pubkey)
    if (!subscriptionId) return

    if (request.method === "logout" && this.logoutFailure) {
      await this.sendResponse(
          event.pubkey,
          request.id,
          undefined,
          this.logoutFailure,
          { route, subscriptionId }
      )
      return
    }
    if (this.requestFailure) {
      await this.sendResponse(
        event.pubkey,
        request.id,
        undefined,
        this.requestFailure,
        { route, subscriptionId }
      )
      return
    }
    if (request.method === "switch_relays") {
      await this.sendResponse(
        event.pubkey,
        request.id,
        "null",
        undefined,
        { route, subscriptionId }
      )
      return
    }
    if (request.method === "get_public_key") {
      if (this.authorizeGetPublicKey) {
        this.authorizeGetPublicKey = false
        this.authorizationRequest = {
          target: { route, subscriptionId },
          clientPublicKey: event.pubkey,
          requestId: request.id,
        }
        await this.sendResponse(
          event.pubkey,
          request.id,
          "auth_url",
          "https://signer.example.com/authorize",
          { route, subscriptionId }
        )
      } else {
        await this.sendResponse(
          event.pubkey,
          request.id,
          this.recipientPublicKey,
          undefined,
          { route, subscriptionId }
        )
      }
      return
    }
    if (request.method === "logout") {
      await this.sendResponse(
        event.pubkey,
        request.id,
        "ack",
        undefined,
        { route, subscriptionId }
      )
    }
  }

  private subscriptionFor(
    subscriptions: Map<string, Record<string, unknown>>,
    clientPublicKey: string
  ): string | null {
    for (const [id, filter] of subscriptions) {
      const recipients = filter["#p"] as string[] | undefined
      if (recipients?.includes(clientPublicKey)) return id
    }
    return null
  }

  private async sendResponse(
    clientPublicKey: string,
    requestId: string,
    result?: string,
    error?: string,
    selectedTarget?: Nip46RelayTarget
  ): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const targets = selectedTarget
        ? [selectedTarget]
        : this.connections.flatMap(({ route, subscriptions }) => {
            const subscriptionId = this.subscriptionFor(
              subscriptions,
              clientPublicKey
            )
            return subscriptionId ? [{ route, subscriptionId }] : []
          })
      if (targets.length > 0) {
        const event = finalizeEvent(
          {
            kind: 24133,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["p", clientPublicKey]],
            content: encrypt(
              JSON.stringify({ id: requestId, result, error }),
              getConversationKey(this.remoteSecretKey, clientPublicKey)
            ),
          },
          this.remoteSecretKey
        )
        for (const target of targets) {
          target.route.send(
            JSON.stringify(["EVENT", target.subscriptionId, event])
          )
        }
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error("NIP-46 client subscription was not established")
  }
}

async function failNip46Persistence(
  page: Page,
  initiallyEnabled = true
): Promise<void> {
  await page.addInitScript((enabled) => {
    const control = {
      get enabled() {
        return localStorage.getItem("npubcash-test-fail-nip46-save") === "true"
      },
      set enabled(value: boolean) {
        if (value) localStorage.setItem("npubcash-test-fail-nip46-save", "true")
        else localStorage.removeItem("npubcash-test-fail-nip46-save")
      },
    }
    if (enabled) control.enabled = true
    Object.assign(window, { __npubcashFailNip46Save: control })
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (
        control.enabled &&
        value &&
        typeof value === "object" &&
        (value as Record<string, unknown>).mode === "nip46"
      ) {
        throw new DOMException("Signer persistence failed", "UnknownError")
      }
      return key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key)
    }
  }, initiallyEnabled)
}

async function delayNip46Persistence(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const control = { pending: false, release: false }
    Object.assign(window, { __npubcashNip46Save: control })
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const request =
        key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key)
      if (
        value &&
        typeof value === "object" &&
        (value as Record<string, unknown>).mode === "nip46"
      ) {
        control.pending = true
        const keepAlive = () => {
          if (control.release) return
          const keepAliveRequest = this.get("__npubcash-keepalive")
          keepAliveRequest.onsuccess = keepAlive
        }
        keepAlive()
      }
      return request
    }
  })
}

async function installNip07(page: Page, publicKey = PUBLIC_KEY_A) {
  await page.addInitScript((initialPublicKey) => {
    if (!localStorage.getItem("npubcash-test-public-key")) {
      localStorage.setItem("npubcash-test-public-key", initialPublicKey)
    }
    Object.defineProperty(window, "nostr", {
      configurable: true,
      value: {
        getPublicKey: async () =>
          localStorage.getItem("npubcash-test-public-key"),
        signEvent: async (event: Record<string, unknown>) => ({
          ...event,
          pubkey: localStorage.getItem("npubcash-test-public-key"),
          id: "0".repeat(64),
          sig: "0".repeat(128),
        }),
      },
    })
  }, publicKey)
}

async function signIn(page: Page) {
  await page.goto("/")
  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
}

async function signInWithNsec(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "Use an nsec" }).click()
  await page.getByLabel("nsec").fill(DIRECT_NSEC)
  await page.getByLabel("Passphrase", { exact: true }).fill(DIRECT_PASSPHRASE)
  await page.getByLabel("Confirm passphrase").fill(DIRECT_PASSPHRASE)
  await page.getByRole("button", { name: "Protect and open Wallet" }).click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
}

async function finishOpening(page: Page) {
  const openWallet = page.getByRole("button", { name: "Open Wallet" })
  await expect(
    openWallet.or(page.getByText("0 sat", { exact: true }))
  ).toBeVisible()
  if (await openWallet.isVisible()) {
    await expect(
      page.getByText("This Wallet exists only in this browser")
    ).toBeVisible()
    await openWallet.click()
  }
}

async function readInstallation(page: Page, publicKey = PUBLIC_KEY_A) {
  return page.evaluate(async (key) => {
    const request = indexedDB.open("npubcash-wallet-registry")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("installations", "readonly")
    const recordRequest = transaction.objectStore("installations").get(key)
    const record = await new Promise<{
      recoveryPhrase: string
      databaseName: string
    }>((resolve, reject) => {
      recordRequest.onsuccess = () => resolve(recordRequest.result)
      recordRequest.onerror = () => reject(recordRequest.error)
    })
    database.close()
    return record
  }, publicKey)
}

async function deleteDatabase(page: Page, name: string) {
  return page.evaluate(async (databaseName) => {
    const request = indexedDB.deleteDatabase(databaseName)
    return new Promise<"deleted" | "blocked">((resolve, reject) => {
      request.onsuccess = () => resolve("deleted")
      request.onblocked = () => resolve("blocked")
      request.onerror = () => reject(request.error)
    })
  }, name)
}

async function readSignerRecord(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("npubcash-signer-vault")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("records", "readonly")
    const recordRequest = transaction.objectStore("records").get("active")
    const record = await new Promise<unknown>((resolve, reject) => {
      recordRequest.onsuccess = () => resolve(recordRequest.result)
      recordRequest.onerror = () => reject(recordRequest.error)
    })
    database.close()
    return record ?? null
  })
}

async function writeSignerRecord(page: Page, record: unknown) {
  await page.evaluate(async (value) => {
    const request = indexedDB.open("npubcash-signer-vault", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("records")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("records", "readwrite")
    transaction.objectStore("records").put(value, "active")
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, record)
}

async function beginRemotePairing(page: Page): Promise<string> {
  await page.goto("/")
  await page.getByRole("button", { name: "Connect remote signer" }).click()
  await expect(
    page.getByRole("heading", { name: "Connect remote signer" })
  ).toBeVisible()
  await expect(page.getByLabel("Remote signer pairing QR code")).toBeVisible()
  return page
    .locator("code")
    .textContent()
    .then((value) => value!)
}

async function signInWithRemoteSigner(
  page: Page,
  fixture: Nip46RelayFixture
): Promise<void> {
  const uri = await beginRemotePairing(page)
  await fixture.pair(uri)
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
}

test("remote signer QR/copy pairing keeps auth correlated and persists only the established connection", async ({
  page,
  context,
}) => {
  const fixture = new Nip46RelayFixture()
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  fixture.authorizeGetPublicKey = true
  await fixture.install(page)
  await context.route("https://signer.example.com/authorize", (route) =>
    route.fulfill({ contentType: "text/html", body: "Authorized" })
  )

  const uri = await beginRemotePairing(page)
  const pairingSecret = new URL(uri).searchParams.get("secret")!
  await page.getByRole("button", { name: "Copy pairing address" }).click()
  await expect(page.getByText("Pairing address copied.")).toBeVisible()
  await fixture.pair(uri)

  await expect(
    page.getByRole("button", { name: "Open authorization page" })
  ).toBeVisible()
  const popupPromise = context.waitForEvent("page")
  await page.getByRole("button", { name: "Open authorization page" }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL("https://signer.example.com/authorize")
  await popup.close()
  await fixture.authorize()
  await finishOpening(page)

  const record = (await readSignerRecord(page)) as Record<string, unknown>
  expect(record).toMatchObject({
    version: 1,
    protocolVersion: 1,
    mode: "nip46",
    remoteSignerPublicKey: fixture.remoteSignerPublicKey,
    expectedPublicKey: fixture.recipientPublicKey,
    relays: ["wss://relay.example.com/"],
  })
  expect(record.clientPublicKey).not.toBe(record.remoteSignerPublicKey)
  expect(record.clientPublicKey).not.toBe(record.expectedPublicKey)
  expect(JSON.stringify(record)).not.toContain(pairingSecret)
  expect(JSON.stringify(record)).not.toContain("nostrconnect://")
})

test("remote signer reload is visibly reconnecting and a Public Key mismatch never opens the Wallet", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await fixture.install(page)
  await signInWithRemoteSigner(page, fixture)

  fixture.authorizeGetPublicKey = true
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Reconnecting remote signer" })
  ).toBeVisible()
  await expect(page.getByText("The Wallet is still closed")).toBeVisible()
  await expect(page.getByText("0 sat", { exact: true })).toBeHidden()
  await fixture.authorize()
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()

  fixture.recipientPublicKey = "d".repeat(64)
  await page.reload()
  await expect(page.getByText("Remote signer unavailable")).toBeVisible()
  await expect(page.getByText(/different Public Key/)).toBeVisible()
  await expect(page.getByText("0 sat", { exact: true })).toBeHidden()
  const databases = await page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name)
      .filter((name) => name?.startsWith("npubcash-wallet-v1:"))
  )
  expect(databases).toEqual([`npubcash-wallet-v1:${"c".repeat(64)}`])
})

test("remote unavailability offers retry, re-pair, and local Sign Out without deleting Wallet Material", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await fixture.install(page)
  await signInWithRemoteSigner(page, fixture)
  const installation = await readInstallation(page, fixture.recipientPublicKey)

  fixture.requestFailure = "remote signer revoked this connection"
  await page.reload()
  await expect(page.getByText("Remote signer unavailable")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Retry connection" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Re-pair signer" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign Out locally" }).click()

  expect(await readSignerRecord(page)).toBeNull()
  expect(
    await page.evaluate(
      (name) =>
        indexedDB
          .databases()
          .then((databases) =>
            databases.some((database) => database.name === name)
          ),
      installation.databaseName
    )
  ).toBe(true)
})

test("cancel erases incomplete pairing and remote logout failure cannot block local Sign Out", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await fixture.install(page)

  await beginRemotePairing(page)
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(
    page.getByText("Sign in with Nostr", { exact: true })
  ).toBeVisible()
  expect(await readSignerRecord(page)).toBeNull()

  await signInWithRemoteSigner(page, fixture)
  const installation = await readInstallation(page, fixture.recipientPublicKey)
  fixture.logoutFailure = "remote signer is offline"
  await page.getByRole("link", { name: "Settings" }).click()
  await expect(page.getByText("NIP-46 remote signer")).toBeVisible()
  await page.getByRole("button", { name: "Sign Out" }).click()

  await expect(page).toHaveURL(/\/$/)
  expect(await readSignerRecord(page)).toBeNull()
  expect(
    await page.evaluate(
      (name) =>
        indexedDB
          .databases()
          .then((databases) =>
            databases.some((database) => database.name === name)
          ),
      installation.databaseName
    )
  ).toBe(true)
})

test("cancel during verified persistence cannot save a signer or reopen the Wallet", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await delayNip46Persistence(page)
  await fixture.install(page)

  const uri = await beginRemotePairing(page)
  await fixture.pair(uri)
  await page.waitForFunction(
    () =>
      (
        window as typeof window & {
          __npubcashNip46Save?: { pending: boolean }
        }
      ).__npubcashNip46Save?.pending === true
  )
  await expect(page.getByText("Signer verified", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  await page.evaluate(() => {
    const controlledWindow = window as typeof window & {
      __npubcashNip46Save: { release: boolean }
    }
    controlledWindow.__npubcashNip46Save.release = true
  })

  await expect(
    page.getByText("Sign in with Nostr", { exact: true })
  ).toBeVisible()
  expect(await readSignerRecord(page)).toBeNull()
  await expect(page.getByText("0 sat", { exact: true })).toBeHidden()
  await expect.poll(() => fixture.closedConnectionCount).toBeGreaterThan(0)
})

test("persistence failure closes the established remote session", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await failNip46Persistence(page)
  await fixture.install(page)

  const uri = await beginRemotePairing(page)
  await fixture.pair(uri)

  await expect(page.getByText("Remote signer did not connect")).toBeVisible()
  await expect(page.getByText("Signer persistence failed")).toBeVisible()
  expect(await readSignerRecord(page)).toBeNull()
  await expect.poll(() => fixture.closedConnectionCount).toBeGreaterThan(0)
  await expect.poll(() => fixture.openConnectionCount).toBe(0)
})

test("reconnect persistence failure closes the replacement remote session", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await failNip46Persistence(page, false)
  await fixture.install(page)
  await signInWithRemoteSigner(page, fixture)
  await page.evaluate(() => {
    const controlledWindow = window as typeof window & {
      __npubcashFailNip46Save: { enabled: boolean }
    }
    controlledWindow.__npubcashFailNip46Save.enabled = true
  })

  await page.reload()

  await expect(page.getByText("Remote signer unavailable")).toBeVisible()
  await expect(page.getByText("Signer persistence failed")).toBeVisible()
  expect(await readSignerRecord(page)).toMatchObject({ mode: "nip46" })
  await expect.poll(() => fixture.openConnectionCount).toBe(0)
})

test("an offline remote signer leaves the Wallet closed with recovery actions", async ({
  page,
}) => {
  const fixture = new Nip46RelayFixture()
  await fixture.install(page)
  await signInWithRemoteSigner(page, fixture)

  await fixture.goOffline()
  await page.reload()

  await expect(page.getByText("Remote signer unavailable")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText("0 sat", { exact: true })).toBeHidden()
  await expect(
    page.getByRole("button", { name: "Retry connection" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign Out locally" })
  ).toBeVisible()
})

test("direct-nsec setup reports field-specific validation", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Use an nsec" }).click()
  await page.getByLabel("nsec").fill("not-an-nsec")
  await page.getByLabel("Passphrase", { exact: true }).fill("too short")
  await page.getByLabel("Confirm passphrase").fill("different")
  await page.getByRole("button", { name: "Protect and open Wallet" }).click()

  await expect(
    page.getByText("Enter a valid nsec Identity Secret.")
  ).toBeVisible()
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible()
  await expect(page.getByText("The passphrases do not match.")).toBeVisible()
  await expect(page.getByLabel("nsec")).toHaveAttribute("aria-invalid", "true")
})

test("direct nsec is encrypted at rest and requires unlock after reload", async ({
  page,
}) => {
  await signInWithNsec(page)
  const installation = await readInstallation(page, DIRECT_PUBLIC_KEY)

  const signerRecordText = JSON.stringify(await readSignerRecord(page))
  expect(signerRecordText).not.toContain(DIRECT_NSEC)
  expect(signerRecordText).not.toContain(DIRECT_PASSPHRASE)

  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Unlock your signer" })
  ).toBeVisible()
  await expect(page.getByText("0 sat", { exact: true })).toBeHidden()
  await page.getByLabel("Passphrase").fill(DIRECT_PASSPHRASE)
  await page.getByRole("button", { name: "Unlock Wallet" }).click()
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
  expect((await readInstallation(page, DIRECT_PUBLIC_KEY)).recoveryPhrase).toBe(
    installation.recoveryPhrase
  )
})

test("wrong direct-nsec passphrase is controlled and leaves the record unchanged", async ({
  page,
}) => {
  await signInWithNsec(page)
  await page.reload()
  const before = await readSignerRecord(page)

  await page.getByLabel("Passphrase").fill("an incorrect passphrase")
  await page.getByRole("button", { name: "Unlock Wallet" }).click()
  await expect(
    page.getByText(
      "The passphrase or encrypted signer record could not be verified."
    )
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Try again in/ })
  ).toBeDisabled()
  await expect(page.getByText("0 sat", { exact: true })).toBeHidden()
  expect(await readSignerRecord(page)).toEqual(before)

  await page.getByLabel("Passphrase").fill(DIRECT_PASSPHRASE)
  await page.getByRole("button", { name: "Unlock Wallet" }).click()
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
})

test("forgetting the passphrase removes only the signer and re-entry reopens the Wallet", async ({
  page,
}) => {
  await signInWithNsec(page)
  const first = await readInstallation(page, DIRECT_PUBLIC_KEY)
  await page.reload()

  await page.getByRole("button", { name: "Forgot passphrase" }).click()
  await expect(
    page.getByRole("heading", { name: "Forget encrypted signer?" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Forget signer" }).click()
  await expect(
    page.getByText("Sign in with Nostr", { exact: true })
  ).toBeVisible()
  expect(await readSignerRecord(page)).toBeNull()
  expect(
    await page.evaluate(
      (name) =>
        indexedDB
          .databases()
          .then((databases) =>
            databases.some((database) => database.name === name)
          ),
      first.databaseName
    )
  ).toBe(true)

  await page.getByRole("button", { name: "Use an nsec" }).click()
  await page.getByLabel("nsec").fill(DIRECT_NSEC)
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("a replacement passphrase")
  await page.getByLabel("Confirm passphrase").fill("a replacement passphrase")
  await page.getByRole("button", { name: "Protect and open Wallet" }).click()
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
  expect((await readInstallation(page, DIRECT_PUBLIC_KEY)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )
})

test("direct-nsec Sign Out removes the signer while retaining the Coco database", async ({
  page,
}) => {
  await signInWithNsec(page)
  const installation = await readInstallation(page, DIRECT_PUBLIC_KEY)

  await page.getByRole("link", { name: "Settings" }).click()
  await expect(page.getByText("Direct nsec, encrypted at rest")).toBeVisible()
  await page.getByRole("button", { name: "Sign Out" }).click()

  expect(await readSignerRecord(page)).toBeNull()
  expect(
    await page.evaluate(
      (name) =>
        indexedDB
          .databases()
          .then((databases) =>
            databases.some((database) => database.name === name)
          ),
      installation.databaseName
    )
  ).toBe(true)
})

test("a different direct nsec opens a distinct Wallet Installation", async ({
  page,
}) => {
  await signInWithNsec(page)
  const first = await readInstallation(page, DIRECT_PUBLIC_KEY)
  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()

  await page.getByRole("button", { name: "Use an nsec" }).click()
  await page.getByLabel("nsec").fill(OTHER_DIRECT_NSEC)
  await page.getByLabel("Passphrase", { exact: true }).fill(DIRECT_PASSPHRASE)
  await page.getByLabel("Confirm passphrase").fill(DIRECT_PASSPHRASE)
  await page.getByRole("button", { name: "Protect and open Wallet" }).click()
  await finishOpening(page)

  const second = await readInstallation(page, OTHER_DIRECT_PUBLIC_KEY)
  expect(second.databaseName).not.toBe(first.databaseName)
  expect(second.recoveryPhrase).not.toBe(first.recoveryPhrase)
})

test("unsupported direct signer envelopes fail closed without silent deletion", async ({
  page,
}) => {
  await page.goto("/")
  const record = {
    version: 1,
    mode: "direct-nsec",
    expectedPublicKey: DIRECT_PUBLIC_KEY,
    envelope: {
      version: 99,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 210_000,
        salt: "AAECAwQFBgcICQoLDA0ODw==",
      },
      cipher: { name: "AES-GCM", iv: "EBESExQVFhcYGRob" },
      ciphertext: "not-used",
    },
  }
  await writeSignerRecord(page, record)
  await page.reload()

  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(page.getByText(/unsupported version/)).toBeVisible()
  expect(await readSignerRecord(page)).toEqual(record)
})

test("first open, reload, Recovery Phrase, and Sign Out/reopen retain Wallet Material", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)
  await expect(
    page.getByText("New Wallet created in this browser")
  ).toBeVisible()

  const first = await readInstallation(page)
  expect(first.recoveryPhrase.split(" ")).toHaveLength(12)

  await page.reload()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
  expect((await readInstallation(page)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await page.getByRole("link", { name: "Recovery Phrase" }).click()
  await page.getByRole("button", { name: "Reveal recovery phrase" }).click()
  await expect(
    page.getByRole("heading", { name: "Reveal your Recovery Phrase?" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Reveal phrase" }).click()
  await expect(
    page
      .getByRole("listitem")
      .filter({
        hasText: first.recoveryPhrase.split(" ")[0],
      })
      .first()
  ).toBeVisible()

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()
  await expect(page).toHaveURL(/\/$/)

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
  expect((await readInstallation(page)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )
})

test("concurrent first open in two tabs reuses one stable Recovery Phrase", async ({
  context,
}) => {
  const firstPage = await context.newPage()
  const secondPage = await context.newPage()
  await Promise.all([installNip07(firstPage), installNip07(secondPage)])
  await Promise.all([firstPage.goto("/"), secondPage.goto("/")])

  await Promise.all([
    firstPage
      .getByRole("button", { name: "Continue with browser extension" })
      .click(),
    secondPage
      .getByRole("button", { name: "Continue with browser extension" })
      .click(),
  ])
  await Promise.all([finishOpening(firstPage), finishOpening(secondPage)])

  await expect(firstPage).toHaveURL(/\/wallet$/)
  await expect(secondPage).toHaveURL(/\/wallet$/)
  const [firstInstallation, secondInstallation] = await Promise.all([
    readInstallation(firstPage),
    readInstallation(secondPage),
  ])
  expect(firstInstallation.recoveryPhrase).toBe(
    secondInstallation.recoveryPhrase
  )
  expect(firstInstallation.databaseName).toBe(secondInstallation.databaseName)
})

test("reports the accepted Wallet initialization sequence", async ({
  page,
}) => {
  await installNip07(page)
  await page.goto("/")
  await page.evaluate(() => {
    const observedStages: string[] = []
    const captureActiveStage = () => {
      const label = document
        .querySelector('[aria-current="step"]')
        ?.textContent?.trim()
      if (label && observedStages.at(-1) !== label) observedStages.push(label)
    }
    new MutationObserver(captureActiveStage).observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    const testWindow = window as Window & {
      __npubcashObservedStages?: string[]
    }
    testWindow.__npubcashObservedStages = observedStages
  })

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()

  const observedStages = await page.evaluate(
    () =>
      (window as Window & { __npubcashObservedStages?: string[] })
        .__npubcashObservedStages ?? []
  )
  expect(observedStages).toEqual([
    "Verifying signer",
    "Opening local Wallet",
    "Starting Coco",
    "Connecting npub.cash",
    "Checking payments",
  ])
})

test("restoration refuses a different extension Public Key", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)

  await page.evaluate((publicKey) => {
    localStorage.setItem("npubcash-test-public-key", publicKey)
  }, PUBLIC_KEY_B)
  await page.reload()

  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(page.getByText(/different Public Key/)).toBeVisible()
  const walletDatabases = await page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name)
      .filter((name) => name?.startsWith("npubcash-wallet-v1:"))
  )
  expect(walletDatabases).toEqual([`npubcash-wallet-v1:${PUBLIC_KEY_A}`])
})

test("identity switching creates isolated Public-Key databases", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)
  const first = await readInstallation(page)

  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()
  await page.evaluate((publicKey) => {
    localStorage.setItem("npubcash-test-public-key", publicKey)
  }, PUBLIC_KEY_B)
  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)

  const second = await readInstallation(page, PUBLIC_KEY_B)
  expect(second.databaseName).not.toBe(first.databaseName)
  expect(second.recoveryPhrase).not.toBe(first.recoveryPhrase)
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases())
        .map((database) => database.name)
        .filter((name) => name?.startsWith("npubcash-wallet-v1:"))
        .sort()
    )
  ).toEqual(
    [
      `npubcash-wallet-v1:${PUBLIC_KEY_A}`,
      `npubcash-wallet-v1:${PUBLIC_KEY_B}`,
    ].sort()
  )
})

test("missing wallet seed refuses to open and confirms destructive removal", async ({
  page,
}) => {
  await installNip07(page)
  await page.goto("/")
  await page.evaluate(async (name) => {
    const request = indexedDB.open(name)
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }, `npubcash-wallet-v1:${PUBLIC_KEY_A}`)

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(
    page.getByText(/Recovery Phrase record is missing/)
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Remove stranded local Wallet" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Remove local Wallet data?" })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Remove local Wallet", exact: true })
    .click()
  await expect(
    page.getByText("Sign in with Nostr", { exact: true })
  ).toBeVisible()
})

test("missing Coco database reuses the stable seed and warns about absent local data", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)
  const first = await readInstallation(page)

  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()
  expect(await deleteDatabase(page, first.databaseName)).toBe("deleted")

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(
    page.getByText("Local Wallet database was missing")
  ).toBeVisible()
  expect((await readInstallation(page)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )
})

test("Sign Out tears down Coco and closes IndexedDB", async ({ page }) => {
  await installNip07(page)
  await signIn(page)
  const installation = await readInstallation(page)

  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()

  expect(await deleteDatabase(page, installation.databaseName)).toBe("deleted")
})

test("missing, rejected, and non-durable browser storage have explicit states", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: async () => false },
    })
  })
  await page.goto("/")
  await expect(
    page.getByRole("button", { name: "Continue with browser extension" })
  ).toBeDisabled()
  await expect(page.getByText("Storage may be temporary")).toBeVisible()

  await page.addInitScript(() => {
    Object.defineProperty(window, "nostr", {
      configurable: true,
      value: {
        getPublicKey: async () => {
          throw new Error("Permission rejected")
        },
        signEvent: async () => {
          throw new Error("Permission rejected")
        },
      },
    })
  })
  await page.reload()
  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(page.getByText("Permission rejected")).toBeVisible()
})

test("phone navigation and Recovery confirmation work from the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installNip07(page)
  await signIn(page)

  const settingsLink = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings" })
  await expect(settingsLink).toBeVisible()
  await settingsLink.focus()
  await page.keyboard.press("Enter")

  const recoveryLink = page.getByRole("link", { name: "Recovery Phrase" })
  await recoveryLink.focus()
  await page.keyboard.press("Enter")

  const revealButton = page.getByRole("button", {
    name: "Reveal recovery phrase",
  })
  await revealButton.focus()
  await page.keyboard.press("Enter")
  const dialogTitle = page.getByRole("heading", {
    name: "Reveal your Recovery Phrase?",
  })
  await expect(dialogTitle).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialogTitle).toBeHidden()
  await expect(revealButton).toBeFocused()
})
