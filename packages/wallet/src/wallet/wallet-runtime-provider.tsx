import { CocoCashuProvider } from "@cashu/coco-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Outlet } from "react-router-dom"

import {
  findNip07Provider,
  Nip07PublicKeyMismatchError,
  Nip07SignerAdapter,
  Nip07UnavailableError,
} from "@/signer/nip07"
import { DirectNsecSignerAdapter } from "@/signer/direct-nsec"
import { DirectNsecUnlockError } from "@/signer/signer-envelope"
import { classifySignerRecordFailure } from "@/signer/signer-record-failure"
import { SignerVault, type DirectNsecSignerRecord } from "@/signer/signer-vault"
import { nextUnlockRetryAt } from "@/signer/unlock-rate-limit"
import {
  MissingWalletSeedError,
  WalletRegistry,
  type WalletInstallation,
} from "./wallet-registry"
import { openWalletRuntime, type WalletRuntime } from "./wallet-runtime"
import { forgetWalletSession } from "./wallet-session-lifecycle"
import {
  WalletRuntimeContext,
  type WalletRuntimeContextValue,
  type WalletSessionState,
  type SignerMode,
} from "./wallet-runtime-context"

const signerVault = new SignerVault()
const walletRegistry = new WalletRegistry()

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The Wallet could not be opened safely."
}

function nextRenderOpportunity(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

export function WalletRuntimeProvider() {
  const [state, setState] = useState<WalletSessionState>({
    phase: "initializing",
    stage: "restoring-session",
  })
  const [extensionAvailable, setExtensionAvailable] = useState(
    () => findNip07Provider() !== null
  )
  const runtimeRef = useRef<WalletRuntime | null>(null)
  const directSignerRef = useRef<DirectNsecSignerAdapter | null>(null)
  const pendingDirectRecordRef = useRef<DirectNsecSignerRecord | null>(null)
  const activeOpenRef = useRef<Promise<void> | null>(null)
  const failedDirectUnlockAttemptsRef = useRef(0)
  const directUnlockRetryAtRef = useRef(0)

  const clearDirectSigner = useCallback(() => {
    directSignerRef.current?.destroy()
    directSignerRef.current = null
  }, [])

  const resetDirectUnlockRateLimit = useCallback(() => {
    failedDirectUnlockAttemptsRef.current = 0
    directUnlockRetryAtRef.current = 0
  }, [])

  const refreshExtensionAvailability = useCallback(() => {
    const available = findNip07Provider() !== null
    setExtensionAvailable(available)
    return available
  }, [])

  useEffect(() => {
    if (extensionAvailable) return

    const timer = window.setInterval(() => {
      if (refreshExtensionAvailability()) window.clearInterval(timer)
    }, 250)

    return () => window.clearInterval(timer)
  }, [extensionAvailable, refreshExtensionAvailability])

  const startRuntime = useCallback(
    async (installation: WalletInstallation, signerMode: SignerMode) => {
      setState({ phase: "initializing", stage: "starting-coco" })
      let runtime: WalletRuntime | null = null

      try {
        await nextRenderOpportunity()
        runtime = await openWalletRuntime(installation)

        // initializeCoco has now initialized the production NPC plugin boundary.
        // Adding an authenticated account and syncing claims remains Slice 4.
        flushSync(() => {
          setState({ phase: "initializing", stage: "connecting-npubcash" })
        })
        await nextRenderOpportunity()

        flushSync(() => {
          setState({ phase: "initializing", stage: "checking-payments" })
        })
        runtime.npubCashAccountCount()
        await nextRenderOpportunity()

        runtimeRef.current = runtime
        setState({ phase: "open", installation, runtime, signerMode })
      } catch (error) {
        await runtime?.close().catch(() => undefined)
        setState({
          phase: "failed",
          kind: "runtime-failed",
          message: errorMessage(error),
          publicKey: installation.publicKey,
        })
      }
    },
    []
  )

  const openForPublicKey = useCallback(
    async (publicKey: string, signerMode: SignerMode) => {
      setState({ phase: "initializing", stage: "opening-wallet" })

      let installation: WalletInstallation
      try {
        installation = await walletRegistry.open(publicKey)
      } catch (error) {
        if (error instanceof MissingWalletSeedError) {
          setState({
            phase: "failed",
            kind: "missing-wallet-seed",
            message: error.message,
            publicKey: error.publicKey,
          })
          return
        }
        setState({
          phase: "failed",
          kind: "runtime-failed",
          message: errorMessage(error),
          publicKey,
        })
        return
      }

      if (installation.condition === "created") {
        setState({
          phase: "new-wallet-warning",
          installation,
          signerMode,
        })
        return
      }

      await startRuntime(installation, signerMode)
    },
    [startRuntime]
  )

  const restore = useCallback(async () => {
    clearDirectSigner()
    resetDirectUnlockRateLimit()
    pendingDirectRecordRef.current = null
    setState({ phase: "initializing", stage: "restoring-session" })
    let signerRecord
    try {
      signerRecord = await signerVault.getActive()
    } catch (error) {
      const failure = classifySignerRecordFailure(error)
      setState({
        phase: "failed",
        kind: failure.kind,
        message: failure.message,
      })
      return
    }

    if (!signerRecord) {
      setState({ phase: "signed-out" })
      return
    }

    if (signerRecord.mode === "direct-nsec") {
      pendingDirectRecordRef.current = signerRecord
      setState({
        phase: "direct-nsec-unlock",
        expectedPublicKey: signerRecord.expectedPublicKey,
        status: "waiting",
      })
      return
    }

    const provider = findNip07Provider()
    if (!provider) {
      setState({
        phase: "failed",
        kind: "extension-missing",
        message:
          "Your NIP-07 extension is not available. Enable it to reopen this Wallet, or Sign Out on this device.",
        publicKey: signerRecord.expectedPublicKey,
      })
      return
    }

    setExtensionAvailable(true)
    setState({ phase: "initializing", stage: "verifying-signer" })

    try {
      const publicKey = await new Nip07SignerAdapter(provider).open(
        signerRecord.expectedPublicKey
      )
      await openForPublicKey(publicKey, "nip07")
    } catch (error) {
      if (error instanceof Nip07PublicKeyMismatchError) {
        setState({
          phase: "failed",
          kind: "public-key-mismatch",
          message:
            "Your extension selected a different Public Key. Switch back to the expected identity, then retry.",
          publicKey: signerRecord.expectedPublicKey,
        })
        return
      }

      setState({
        phase: "failed",
        kind: "signer-rejected",
        message: errorMessage(error),
        publicKey: signerRecord.expectedPublicKey,
      })
    }
  }, [clearDirectSigner, openForPublicKey, resetDirectUnlockRateLimit])

  const runOneOpen = useCallback((operation: () => Promise<void>) => {
    activeOpenRef.current ??= operation().finally(() => {
      activeOpenRef.current = null
    })
    return activeOpenRef.current
  }, [])

  const signInWithNip07 = useCallback(
    () =>
      runOneOpen(async () => {
        const provider = findNip07Provider()
        if (!provider) throw new Nip07UnavailableError()

        setExtensionAvailable(true)
        setState({ phase: "initializing", stage: "verifying-signer" })

        try {
          const publicKey = await new Nip07SignerAdapter(provider).open()
          await signerVault.saveNip07(publicKey)
          await openForPublicKey(publicKey, "nip07")
        } catch (error) {
          setState({
            phase: "failed",
            kind:
              error instanceof Nip07UnavailableError
                ? "extension-missing"
                : "signer-rejected",
            message: errorMessage(error),
          })
        }
      }),
    [openForPublicKey, runOneOpen]
  )

  const signInWithDirectNsec = useCallback(
    async (nsec: string, passphrase: string) => {
      let result: { ok: true } | { ok: false; message: string } = { ok: true }

      await runOneOpen(async () => {
        try {
          const signer = await signerVault.saveDirectNsec(nsec, passphrase)
          clearDirectSigner()
          directSignerRef.current = signer
          pendingDirectRecordRef.current = null
          await openForPublicKey(signer.publicKey, "direct-nsec")
        } catch (error) {
          result = { ok: false, message: errorMessage(error) }
        }
      })

      return result
    },
    [clearDirectSigner, openForPublicKey, runOneOpen]
  )

  const unlockDirectNsec = useCallback(
    (passphrase: string) =>
      runOneOpen(async () => {
        const record = pendingDirectRecordRef.current
        if (!record) {
          await restore()
          return
        }

        const now = Date.now()
        if (now < directUnlockRetryAtRef.current) {
          setState({
            phase: "direct-nsec-unlock",
            expectedPublicKey: record.expectedPublicKey,
            status: "failed",
            message:
              "The passphrase or encrypted signer record could not be verified.",
            retryAt: directUnlockRetryAtRef.current,
          })
          return
        }

        setState({
          phase: "direct-nsec-unlock",
          expectedPublicKey: record.expectedPublicKey,
          status: "decrypting",
        })

        try {
          const signer = await signerVault.unlockDirectNsec(record, passphrase)
          resetDirectUnlockRateLimit()
          clearDirectSigner()
          directSignerRef.current = signer
          await openForPublicKey(signer.publicKey, "direct-nsec")
        } catch (error) {
          if (error instanceof DirectNsecUnlockError) {
            failedDirectUnlockAttemptsRef.current += 1
            directUnlockRetryAtRef.current = nextUnlockRetryAt(
              failedDirectUnlockAttemptsRef.current
            )
            setState({
              phase: "direct-nsec-unlock",
              expectedPublicKey: record.expectedPublicKey,
              status: "failed",
              message: error.message,
              retryAt: directUnlockRetryAtRef.current,
            })
            return
          }

          const failure = classifySignerRecordFailure(error)
          setState({
            phase: "failed",
            kind: failure.kind,
            message: failure.message,
            publicKey: record.expectedPublicKey,
          })
        }
      }),
    [
      clearDirectSigner,
      openForPublicKey,
      resetDirectUnlockRateLimit,
      restore,
      runOneOpen,
    ]
  )

  const forgetDirectNsec = useCallback(async () => {
    const record = pendingDirectRecordRef.current
    if (record) {
      setState({
        phase: "direct-nsec-unlock",
        expectedPublicKey: record.expectedPublicKey,
        status: "forgetting",
      })
    }

    try {
      await signerVault.removeActive()
      pendingDirectRecordRef.current = null
      resetDirectUnlockRateLimit()
      clearDirectSigner()
      setState({ phase: "signed-out" })
    } catch (error) {
      setState({
        phase: "failed",
        kind: "runtime-failed",
        message: errorMessage(error),
        publicKey: record?.expectedPublicKey,
      })
    }
  }, [clearDirectSigner, resetDirectUnlockRateLimit])

  const signOut = useCallback(async () => {
    const runtime = runtimeRef.current
    runtimeRef.current = null
    try {
      await forgetWalletSession(runtime, signerVault, clearDirectSigner)
    } finally {
      pendingDirectRecordRef.current = null
      resetDirectUnlockRateLimit()
      setState({ phase: "signed-out" })
    }
  }, [clearDirectSigner, resetDirectUnlockRateLimit])

  const continueOpeningWallet = useCallback(() => {
    if (state.phase !== "new-wallet-warning") return Promise.resolve()
    return runOneOpen(() => startRuntime(state.installation, state.signerMode))
  }, [runOneOpen, startRuntime, state])

  const removeStrandedWallet = useCallback(async () => {
    if (state.phase !== "failed" || !state.publicKey) return

    await walletRegistry.remove(state.publicKey)
    await signOut()
  }, [signOut, state])

  useEffect(() => {
    void runOneOpen(restore)

    return () => {
      const runtime = runtimeRef.current
      runtimeRef.current = null
      clearDirectSigner()
      void runtime?.close()
    }
  }, [clearDirectSigner, restore, runOneOpen])

  const value = useMemo<WalletRuntimeContextValue>(
    () => ({
      state,
      extensionAvailable,
      signInWithNip07,
      signInWithDirectNsec,
      unlockDirectNsec,
      forgetDirectNsec,
      continueOpeningWallet,
      retry: () => runOneOpen(restore),
      signOut,
      removeStrandedWallet,
    }),
    [
      extensionAvailable,
      continueOpeningWallet,
      removeStrandedWallet,
      restore,
      runOneOpen,
      signInWithNip07,
      signInWithDirectNsec,
      signOut,
      state,
      unlockDirectNsec,
      forgetDirectNsec,
    ]
  )

  const outlet = <Outlet />

  return (
    <WalletRuntimeContext.Provider value={value}>
      {state.phase === "open" ? (
        <CocoCashuProvider
          key={state.installation.publicKey}
          manager={state.runtime.coco}
        >
          {outlet}
        </CocoCashuProvider>
      ) : (
        outlet
      )}
    </WalletRuntimeContext.Provider>
  )
}
