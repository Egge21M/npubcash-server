import { normalizePublicKey } from "./nip07"
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

const ACTIVE_RECORD_KEY = "active"
const RECORDS_STORE = "records"

export class SignerVault {
  private databasePromise: Promise<IDBDatabase> | null = null
  private readonly databaseName: string

  constructor(databaseName = "npubcash-signer-vault") {
    this.databaseName = databaseName
  }

  async getActive(): Promise<Nip07SignerRecord | null> {
    const database = await this.database()
    const transaction = database.transaction(RECORDS_STORE, "readonly")
    const record = await requestResult(
      transaction.objectStore(RECORDS_STORE).get(ACTIVE_RECORD_KEY)
    )
    await transactionDone(transaction)
    return (record as Nip07SignerRecord | undefined) ?? null
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

  async removeActive(): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(RECORDS_STORE, "readwrite")
    transaction.objectStore(RECORDS_STORE).delete(ACTIVE_RECORD_KEY)
    await transactionDone(transaction)
  }

  close(): void {
    void this.databasePromise?.then((database) => database.close())
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
