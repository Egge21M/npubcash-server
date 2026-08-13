import { createContext, useContext } from "react"

import type { WalletInstallation } from "./wallet-registry"
import type { WalletRuntime } from "./wallet-runtime"

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
  | "runtime-failed"

export type WalletSessionState =
  | { phase: "initializing"; stage: InitializationStage }
  | { phase: "signed-out" }
  | {
      phase: "new-wallet-warning"
      installation: WalletInstallation
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
    }

export interface WalletRuntimeContextValue {
  state: WalletSessionState
  extensionAvailable: boolean
  signInWithNip07(): Promise<void>
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
