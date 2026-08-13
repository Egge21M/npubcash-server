import { afterEach, describe, expect, test } from "bun:test"
import "fake-indexeddb/auto"

import {
  SignerVault,
  SignerVaultCorruptRecordError,
  SignerVaultStorageError,
  SignerVaultUnsupportedRecordError,
} from "./signer-vault"

const NSEC_ONE =
  "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl"
const NSEC_PUBLIC_KEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
const PASSPHRASE = "correct horse battery staple"

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

  test("persists an encrypted direct-nsec record and unlocks the same Public Key", async () => {
    const vault = new SignerVault("npubcash-signer-vault-test")

    const signer = await vault.saveDirectNsec(NSEC_ONE, PASSPHRASE)
    expect(signer.publicKey).toBe(NSEC_PUBLIC_KEY)
    signer.destroy()

    const record = await vault.getActive()
    expect(record).toMatchObject({
      version: 1,
      mode: "direct-nsec",
      expectedPublicKey: NSEC_PUBLIC_KEY,
      envelope: {
        version: 1,
        kdf: { name: "PBKDF2", hash: "SHA-256" },
        cipher: { name: "AES-GCM" },
      },
    })
    expect(JSON.stringify(record)).not.toContain(NSEC_ONE)
    expect(JSON.stringify(record)).not.toContain(PASSPHRASE)

    if (!record || record.mode !== "direct-nsec") {
      throw new Error("Expected a direct-nsec signer record")
    }
    const restoredSigner = await vault.unlockDirectNsec(record, PASSPHRASE)
    expect(restoredSigner.publicKey).toBe(NSEC_PUBLIC_KEY)
    restoredSigner.destroy()
    vault.close()
  })

  test("does not mutate the active record after a failed unlock", async () => {
    const vault = new SignerVault("npubcash-signer-vault-test")
    const signer = await vault.saveDirectNsec(NSEC_ONE, PASSPHRASE)
    signer.destroy()
    const record = await vault.getActive()
    if (!record || record.mode !== "direct-nsec") {
      throw new Error("Expected a direct-nsec signer record")
    }
    const before = structuredClone(record)

    await expect(
      vault.unlockDirectNsec(record, "incorrect passphrase")
    ).rejects.toThrow(
      "The passphrase or encrypted signer record could not be verified."
    )
    expect(await vault.getActive()).toEqual(before)
    vault.close()
  })

  test("preserves unsupported and corrupt records for explicit recovery", async () => {
    const databaseName = "npubcash-signer-vault-test"
    const putRawRecord = async (record: unknown) => {
      const request = indexedDB.open(databaseName, 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore("records")
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = database.transaction("records", "readwrite")
      transaction.objectStore("records").put(record, "active")
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
    }
    const readRawRecord = async () => {
      const request = indexedDB.open(databaseName, 1)
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = database.transaction("records", "readonly")
      const getRequest = transaction.objectStore("records").get("active")
      const record = await new Promise<unknown>((resolve, reject) => {
        getRequest.onsuccess = () => resolve(getRequest.result)
        getRequest.onerror = () => reject(getRequest.error)
      })
      database.close()
      return record
    }

    const unsupported = { version: 99, mode: "future-signer" }
    await putRawRecord(unsupported)
    const vault = new SignerVault(databaseName)
    await expect(vault.getActive()).rejects.toBeInstanceOf(
      SignerVaultUnsupportedRecordError
    )
    expect(await readRawRecord()).toEqual(unsupported)
    vault.close()

    await indexedDB.deleteDatabase(databaseName)
    const corrupt = {
      version: 1,
      mode: "nip07",
      expectedPublicKey: "not-a-public-key",
    }
    await putRawRecord(corrupt)
    const corruptVault = new SignerVault(databaseName)
    await expect(corruptVault.getActive()).rejects.toBeInstanceOf(
      SignerVaultCorruptRecordError
    )
    expect(await readRawRecord()).toEqual(corrupt)
    corruptVault.close()
  })

  test("opens the legacy version-1 NIP-07 record without rewriting it", async () => {
    const databaseName = "npubcash-signer-vault-test"
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("records")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const legacyRecord = {
      version: 1,
      mode: "nip07",
      expectedPublicKey: PUBLIC_KEY,
    }
    const transaction = database.transaction("records", "readwrite")
    transaction.objectStore("records").put(legacyRecord, "active")
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    const vault = new SignerVault(databaseName)
    expect(await vault.getActive()).toEqual(legacyRecord)
    vault.close()
  })

  test("an interrupted direct-nsec write leaves the prior signer record intact", async () => {
    const vault = new SignerVault("npubcash-signer-vault-test")
    await vault.saveNip07(PUBLIC_KEY)
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Write interrupted", "AbortError")
    } as typeof IDBObjectStore.prototype.put

    try {
      await expect(vault.saveDirectNsec(NSEC_ONE, PASSPHRASE)).rejects.toThrow(
        "Write interrupted"
      )
    } finally {
      IDBObjectStore.prototype.put = originalPut
    }

    expect(await vault.getActive()).toEqual({
      version: 1,
      mode: "nip07",
      expectedPublicKey: PUBLIC_KEY,
    })
    vault.close()
  })

  test("reports a newer database version as a storage migration failure", async () => {
    const databaseName = "npubcash-signer-vault-test"
    const request = indexedDB.open(databaseName, 2)
    request.onupgradeneeded = () => request.result.createObjectStore("records")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()

    const vault = new SignerVault(databaseName)
    await expect(vault.getActive()).rejects.toBeInstanceOf(
      SignerVaultStorageError
    )
    vault.close()
  })
})
