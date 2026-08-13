export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true }
    )
  })
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true })
    transaction.addEventListener(
      "abort",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true }
    )
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true }
    )
  })
}

export async function openDatabase(
  name: string,
  version: number,
  upgrade: (database: IDBDatabase) => void
): Promise<IDBDatabase> {
  const request = indexedDB.open(name, version)
  request.addEventListener("upgradeneeded", () => upgrade(request.result))
  return requestResult(request)
}

export async function deleteDatabase(name: string): Promise<void> {
  await requestResult(indexedDB.deleteDatabase(name))
}
