import { generateMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"

import { normalizePublicKey } from "@/signer/nip07"
import {
  deleteDatabase,
  openDatabase,
  requestResult,
  transactionDone,
} from "@/storage/indexeddb"

const INSTALLATIONS_STORE = "installations"

export type WalletInstallationCondition =
  "created" | "existing" | "database-recreated"

export interface WalletInstallation {
  version: 1
  publicKey: string
  databaseName: string
  recoveryPhrase: string
  createdAt: number
  condition: WalletInstallationCondition
}

interface WalletInstallationRecord {
  version: 1
  publicKey: string
  databaseName: string
  recoveryPhrase: string
  createdAt: number
}

interface WalletRegistryOptions {
  databaseName?: string
  walletDatabasePrefix?: string
  generateRecoveryPhrase?: () => string
}

export class MissingWalletSeedError extends Error {
  readonly publicKey: string
  readonly databaseName: string

  constructor(publicKey: string, databaseName: string) {
    super(
      "This Wallet database exists, but its Recovery Phrase record is missing."
    )
    this.name = "MissingWalletSeedError"
    this.publicKey = publicKey
    this.databaseName = databaseName
  }
}

export class WalletRegistry {
  private readonly databaseName: string
  private readonly walletDatabasePrefix: string
  private readonly generateRecoveryPhrase: () => string
  private databasePromise: Promise<IDBDatabase> | null = null
  private readonly queues = new Map<string, Promise<void>>()

  constructor(options: WalletRegistryOptions = {}) {
    this.databaseName = options.databaseName ?? "npubcash-wallet-registry"
    this.walletDatabasePrefix =
      options.walletDatabasePrefix ?? "npubcash-wallet-v1:"
    this.generateRecoveryPhrase =
      options.generateRecoveryPhrase ?? (() => generateMnemonic(wordlist, 128))
  }

  async open(publicKey: string): Promise<WalletInstallation> {
    const normalizedPublicKey = normalizePublicKey(publicKey)
    const lockName = `npubcash:create-wallet:${normalizedPublicKey}`

    if (globalThis.navigator?.locks) {
      return navigator.locks.request(lockName, () =>
        this.openWhileLocked(normalizedPublicKey)
      )
    }

    return this.runInProcessExclusive(lockName, () =>
      this.openWhileLocked(normalizedPublicKey)
    )
  }

  async get(publicKey: string): Promise<WalletInstallationRecord | null> {
    const normalizedPublicKey = normalizePublicKey(publicKey)
    const database = await this.database()
    const transaction = database.transaction(INSTALLATIONS_STORE, "readonly")
    const result = await requestResult(
      transaction.objectStore(INSTALLATIONS_STORE).get(normalizedPublicKey)
    )
    await transactionDone(transaction)
    return (result as WalletInstallationRecord | undefined) ?? null
  }

  async remove(publicKey: string): Promise<void> {
    const normalizedPublicKey = normalizePublicKey(publicKey)
    const databaseName = this.walletDatabaseName(normalizedPublicKey)
    const database = await this.database()
    const transaction = database.transaction(INSTALLATIONS_STORE, "readwrite")
    transaction.objectStore(INSTALLATIONS_STORE).delete(normalizedPublicKey)
    await transactionDone(transaction)
    await deleteDatabase(databaseName)
  }

  close(): void {
    void this.databasePromise?.then((database) => database.close())
    this.databasePromise = null
  }

  private async openWhileLocked(
    publicKey: string
  ): Promise<WalletInstallation> {
    const databaseName = this.walletDatabaseName(publicKey)
    const [record, walletDatabaseExists] = await Promise.all([
      this.get(publicKey),
      this.databaseExists(databaseName),
    ])

    if (!record && walletDatabaseExists) {
      throw new MissingWalletSeedError(publicKey, databaseName)
    }

    if (record) {
      return {
        ...record,
        condition: walletDatabaseExists ? "existing" : "database-recreated",
      }
    }

    const created: WalletInstallationRecord = {
      version: 1,
      publicKey,
      databaseName,
      recoveryPhrase: this.generateRecoveryPhrase(),
      createdAt: Date.now(),
    }
    const database = await this.database()
    const transaction = database.transaction(INSTALLATIONS_STORE, "readwrite")
    transaction.objectStore(INSTALLATIONS_STORE).add(created)
    await transactionDone(transaction)

    return { ...created, condition: "created" }
  }

  private async databaseExists(name: string): Promise<boolean> {
    if (typeof indexedDB.databases !== "function") {
      throw new Error(
        "This browser cannot safely inspect local Wallet databases."
      )
    }

    return (await indexedDB.databases()).some(
      (database) => database.name === name
    )
  }

  private walletDatabaseName(publicKey: string): string {
    return `${this.walletDatabasePrefix}${publicKey}`
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase(this.databaseName, 1, (database) => {
      if (!database.objectStoreNames.contains(INSTALLATIONS_STORE)) {
        database.createObjectStore(INSTALLATIONS_STORE, {
          keyPath: "publicKey",
        })
      }
    })
    return this.databasePromise
  }

  private async runInProcessExclusive<T>(
    key: string,
    action: () => Promise<T>
  ): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    this.queues.set(key, queued)

    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.queues.get(key) === queued) {
        this.queues.delete(key)
      }
    }
  }
}
