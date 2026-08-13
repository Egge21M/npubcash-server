import { normalizePublicKey } from "./nip07"
import { decodeDirectNsec, DirectNsecSignerAdapter } from "./direct-nsec"
import {
  CorruptSignerEnvelopeError,
  decryptDirectNsecEnvelope,
  encryptDirectNsecEnvelope,
  readDirectNsecEnvelope,
  type DirectNsecEnvelopeV1,
  UnsupportedSignerEnvelopeError,
} from "./signer-envelope"
import {
  openDatabase,
  requestResult,
  transactionDone,
} from "@/storage/indexeddb"

export interface Nip07SignerRecord {
  version: 1
  mode: "nip07"
  expectedPublicKey: string
}

export interface DirectNsecSignerRecord {
  version: 1
  mode: "direct-nsec"
  expectedPublicKey: string
  envelope: DirectNsecEnvelopeV1
}

export type SignerRecord = Nip07SignerRecord | DirectNsecSignerRecord

export const MINIMUM_SIGNER_PASSPHRASE_LENGTH = 12

export class SignerPassphraseTooShortError extends Error {
  constructor() {
    super(
      `Use a passphrase with at least ${MINIMUM_SIGNER_PASSPHRASE_LENGTH} characters.`
    )
    this.name = "SignerPassphraseTooShortError"
  }
}

export class SignerVaultCorruptRecordError extends Error {
  constructor() {
    super("The saved signer record is damaged and cannot be opened safely.")
    this.name = "SignerVaultCorruptRecordError"
  }
}

export class SignerVaultUnsupportedRecordError extends Error {
  constructor() {
    super("The saved signer record uses an unsupported version.")
    this.name = "SignerVaultUnsupportedRecordError"
  }
}

export class SignerVaultStorageError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The saved signer record could not be read. Check browser storage and retry.",
      options
    )
    this.name = "SignerVaultStorageError"
  }
}

const ACTIVE_RECORD_KEY = "active"
const RECORDS_STORE = "records"

export class SignerVault {
  private databasePromise: Promise<IDBDatabase> | null = null
  private readonly databaseName: string

  constructor(databaseName = "npubcash-signer-vault") {
    this.databaseName = databaseName
  }

  async getActive(): Promise<SignerRecord | null> {
    let database: IDBDatabase | null = null
    try {
      database = await this.database()
      const transaction = database.transaction(RECORDS_STORE, "readonly")
      const record = await requestResult(
        transaction.objectStore(RECORDS_STORE).get(ACTIVE_RECORD_KEY)
      )
      await transactionDone(transaction)
      return record === undefined ? null : readSignerRecord(record)
    } catch (error) {
      if (
        error instanceof SignerVaultCorruptRecordError ||
        error instanceof SignerVaultUnsupportedRecordError
      ) {
        throw error
      }
      database?.close()
      this.databasePromise = null
      throw new SignerVaultStorageError({ cause: error })
    }
  }

  async saveNip07(publicKey: string): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(RECORDS_STORE, "readwrite")
    transaction.objectStore(RECORDS_STORE).put(
      {
        version: 1,
        mode: "nip07",
        expectedPublicKey: normalizePublicKey(publicKey),
      } satisfies Nip07SignerRecord,
      ACTIVE_RECORD_KEY
    )
    await transactionDone(transaction)
  }

  async saveDirectNsec(
    nsec: string,
    passphrase: string
  ): Promise<DirectNsecSignerAdapter> {
    if (passphrase.length < MINIMUM_SIGNER_PASSPHRASE_LENGTH) {
      throw new SignerPassphraseTooShortError()
    }

    const secretKey = decodeDirectNsec(nsec)
    let signer: DirectNsecSignerAdapter | null = null

    try {
      signer = new DirectNsecSignerAdapter(secretKey)
      const envelope = await encryptDirectNsecEnvelope(secretKey, passphrase)
      const record = {
        version: 1,
        mode: "direct-nsec",
        expectedPublicKey: signer.publicKey,
        envelope,
      } satisfies DirectNsecSignerRecord
      const database = await this.database()
      const transaction = database.transaction(RECORDS_STORE, "readwrite")
      transaction.objectStore(RECORDS_STORE).put(record, ACTIVE_RECORD_KEY)
      await transactionDone(transaction)
      return signer
    } catch (error) {
      signer?.destroy()
      throw error
    } finally {
      secretKey.fill(0)
    }
  }

  async unlockDirectNsec(
    storedRecord: DirectNsecSignerRecord,
    passphrase: string
  ): Promise<DirectNsecSignerAdapter> {
    const record = readSignerRecord(storedRecord)
    if (record.mode !== "direct-nsec") {
      throw new SignerVaultCorruptRecordError()
    }

    const secretKey = await decryptDirectNsecEnvelope(
      record.envelope,
      passphrase
    )
    let signer: DirectNsecSignerAdapter | null = null
    try {
      signer = new DirectNsecSignerAdapter(secretKey)
      if (signer.publicKey !== record.expectedPublicKey) {
        signer.destroy()
        signer = null
        throw new SignerVaultCorruptRecordError()
      }
      return signer
    } finally {
      secretKey.fill(0)
    }
  }

  async removeActive(): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(RECORDS_STORE, "readwrite")
    transaction.objectStore(RECORDS_STORE).delete(ACTIVE_RECORD_KEY)
    await transactionDone(transaction)
  }

  close(): void {
    void this.databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined)
    this.databasePromise = null
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase(this.databaseName, 1, (database) => {
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        database.createObjectStore(RECORDS_STORE)
      }
    })
    return this.databasePromise
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readExpectedPublicKey(value: unknown): string {
  if (typeof value !== "string") throw new SignerVaultCorruptRecordError()
  try {
    return normalizePublicKey(value)
  } catch {
    throw new SignerVaultCorruptRecordError()
  }
}

function readSignerRecord(value: unknown): SignerRecord {
  if (!isRecord(value)) throw new SignerVaultCorruptRecordError()
  if (value.version !== 1) throw new SignerVaultUnsupportedRecordError()

  if (value.mode === "nip07") {
    return {
      version: 1,
      mode: "nip07",
      expectedPublicKey: readExpectedPublicKey(value.expectedPublicKey),
    }
  }

  if (value.mode === "direct-nsec") {
    try {
      return {
        version: 1,
        mode: "direct-nsec",
        expectedPublicKey: readExpectedPublicKey(value.expectedPublicKey),
        envelope: readDirectNsecEnvelope(value.envelope),
      }
    } catch (error) {
      if (error instanceof UnsupportedSignerEnvelopeError) {
        throw new SignerVaultUnsupportedRecordError()
      }
      if (error instanceof CorruptSignerEnvelopeError) {
        throw new SignerVaultCorruptRecordError()
      }
      throw error
    }
  }

  throw new SignerVaultUnsupportedRecordError()
}
