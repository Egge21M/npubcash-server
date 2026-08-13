interface ClosableWalletRuntime {
  close(): Promise<void>
}

interface RemovableSignerRecord {
  removeActive(): Promise<void>
}

export async function forgetWalletSession(
  runtime: ClosableWalletRuntime | null,
  signerVault: RemovableSignerRecord
): Promise<void> {
  try {
    await runtime?.close()
  } catch {
    // The runtime closes IndexedDB in a finally. Sign Out must continue and
    // forget the signer even when a Manager cleanup reports an error.
  }

  await signerVault.removeActive()
}
