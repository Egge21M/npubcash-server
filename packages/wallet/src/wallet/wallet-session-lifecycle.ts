interface ClosableWalletRuntime {
  close(): Promise<void>
}

interface RemovableSignerRecord {
  removeActive(): Promise<void>
}

export async function forgetWalletSession(
  runtime: ClosableWalletRuntime | null,
  signerVault: RemovableSignerRecord,
  clearRuntimeSigner: () => void | Promise<void> = () => undefined,
  remoteLogout?: () => Promise<void>
): Promise<void> {
  try {
    await remoteLogout?.()
  } catch {
    // Remote logout is a courtesy request. Local Sign Out must not depend on
    // the signer, its relay, or its authorization UI being available.
  }

  let signerRemovalError: unknown
  try {
    await signerVault.removeActive()
  } catch (error) {
    signerRemovalError = error
  }
  try {
    await clearRuntimeSigner()
  } catch (error) {
    signerRemovalError ??= error
  }

  try {
    await runtime?.close()
  } catch {
    // The runtime closes IndexedDB in a finally. Sign Out must finish even
    // when Manager cleanup reports an error.
  }

  if (signerRemovalError) throw signerRemovalError
}
