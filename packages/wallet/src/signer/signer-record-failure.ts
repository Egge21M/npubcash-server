import type { WalletRuntimeErrorKind } from "@/wallet/wallet-runtime-context"

import {
  SignerVaultCorruptRecordError,
  SignerVaultStorageError,
  SignerVaultUnsupportedRecordError,
} from "./signer-vault"

export interface SignerRecordFailure {
  kind: Extract<
    WalletRuntimeErrorKind,
    "signer-record-corrupt" | "signer-record-unsupported" | "runtime-failed"
  >
  message: string
  retryable: boolean
}

export function classifySignerRecordFailure(
  error: unknown
): SignerRecordFailure {
  if (error instanceof SignerVaultUnsupportedRecordError) {
    return {
      kind: "signer-record-unsupported",
      message: error.message,
      retryable: false,
    }
  }
  if (error instanceof SignerVaultCorruptRecordError) {
    return {
      kind: "signer-record-corrupt",
      message: error.message,
      retryable: false,
    }
  }
  if (error instanceof SignerVaultStorageError) {
    return { kind: "runtime-failed", message: error.message, retryable: true }
  }
  return {
    kind: "runtime-failed",
    message: "The saved signer record could not be read safely. Retry.",
    retryable: true,
  }
}
