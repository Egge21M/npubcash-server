import { createContext, useContext } from "react"

import type { WalletInstallation } from "./wallet-registry"
import type { WalletRuntime } from "./wallet-runtime"

export type SignerMode = "nip07" | "direct-nsec"

export type InitializationStage =
  | "restoring-session"
  | "verifying-signer"
  | "opening-wallet"
  | "starting-coco"
  | "connecting-npubcash"
  | "checking-payments"

export type WalletRuntimeErrorKind =
  | "extension-missing"
  | "public-key-mismatch"
  | "signer-rejected"
  | "missing-wallet-seed"
  | "signer-record-corrupt"
  | "signer-record-unsupported"
  | "runtime-failed"

export type DirectNsecUnlockStatus =
  "waiting" | "decrypting" | "failed" | "forgetting"

export type SignerCommandResult = { ok: true } | { ok: false; message: string }

export type WalletSessionState =
  | { phase: "initializing"; stage: InitializationStage }
  | { phase: "signed-out" }
  | {
      phase: "direct-nsec-unlock"
      expectedPublicKey: string
      status: DirectNsecUnlockStatus
      message?: string
      retryAt?: number
    }
  | {
      phase: "new-wallet-warning"
      installation: WalletInstallation
      signerMode: SignerMode
    }
  | {
      phase: "failed"
      kind: WalletRuntimeErrorKind
      message: string
      publicKey?: string
    }
  | {
      phase: "open"
      installation: WalletInstallation
      runtime: WalletRuntime
      signerMode: SignerMode
    }

export interface WalletRuntimeContextValue {
  state: WalletSessionState
  extensionAvailable: boolean
  signInWithNip07(): Promise<void>
  signInWithDirectNsec(
    nsec: string,
    passphrase: string
  ): Promise<SignerCommandResult>
  unlockDirectNsec(passphrase: string): Promise<void>
  forgetDirectNsec(): Promise<void>
  continueOpeningWallet(): Promise<void>
  retry(): Promise<void>
  signOut(): Promise<void>
  removeStrandedWallet(): Promise<void>
}

export const WalletRuntimeContext =
  createContext<WalletRuntimeContextValue | null>(null)

export function useWalletRuntime(): WalletRuntimeContextValue {
  const context = useContext(WalletRuntimeContext)
  if (!context) {
    throw new Error(
      "useWalletRuntime must be used inside WalletRuntimeProvider"
    )
  }
  return context
}
