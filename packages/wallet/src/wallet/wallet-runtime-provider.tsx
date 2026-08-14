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
  createNip46Pairing,
  Nip46CanceledError,
  Nip46ProtocolError,
  Nip46PublicKeyMismatchError,
  Nip46SpoofedResponseError,
  type Nip46Pairing,
  type Nip46Session,
  Nip46TimeoutError,
  Nip46UnavailableError,
  reconnectNip46,
} from "@/signer/nip46-session"
import { walletEnvironment } from "@/config/environment"
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

function nip46FailureKind(error: unknown) {
  if (error instanceof Nip46TimeoutError) return "timeout" as const
  if (error instanceof Nip46PublicKeyMismatchError) {
    return "public-key-mismatch" as const
  }
  if (error instanceof Nip46ProtocolError) return "malformed-response" as const
  if (error instanceof Nip46SpoofedResponseError) {
    return "spoofed-response" as const
  }
  if (error instanceof Nip46UnavailableError) return "relay-loss" as const
  if (
    error instanceof Error &&
    /reject|denied|authorization/i.test(error.message)
  ) {
    return "authorization-rejected" as const
  }
  return "revoked" as const
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
  const nip46PairingRef = useRef<Nip46Pairing | null>(null)
  const nip46SessionRef = useRef<Nip46Session | null>(null)
  const nip46ReconnectAbortRef = useRef<AbortController | null>(null)
  const activeOpenRef = useRef<Promise<void> | null>(null)
  const failedDirectUnlockAttemptsRef = useRef(0)
  const directUnlockRetryAtRef = useRef(0)

  const clearDirectSigner = useCallback(() => {
    directSignerRef.current?.destroy()
    directSignerRef.current = null
  }, [])

  const clearNip46Session = useCallback(async () => {
    const session = nip46SessionRef.current
    nip46SessionRef.current = null
    await session?.close()
  }, [])

  const clearRuntimeSigners = useCallback(async () => {
    clearDirectSigner()
    await clearNip46Session()
  }, [clearDirectSigner, clearNip46Session])

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
    nip46ReconnectAbortRef.current?.abort()
    nip46ReconnectAbortRef.current = null
    clearDirectSigner()
    await clearNip46Session()
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

    if (signerRecord.mode === "nip46") {
      const reconnectController = new AbortController()
      let established: Awaited<ReturnType<typeof reconnectNip46>> | null = null
      nip46ReconnectAbortRef.current = reconnectController
      setState({
        phase: "nip46-reconnecting",
        expectedPublicKey: signerRecord.expectedPublicKey,
        status: "reconnecting",
      })
      try {
        await nextRenderOpportunity()
        established = await reconnectNip46(signerRecord, {
          signal: reconnectController.signal,
          onAuthorization: ({ url }) => {
            setState({
              phase: "nip46-reconnecting",
              expectedPublicKey: signerRecord.expectedPublicKey,
              status: "awaiting-authorization",
              authorizationUrl: url,
            })
          },
        })
        if (
          reconnectController.signal.aborted ||
          nip46ReconnectAbortRef.current !== reconnectController
        ) {
          await established.session.close()
          return
        }
        await signerVault.saveNip46(established.record)
        if (
          reconnectController.signal.aborted ||
          nip46ReconnectAbortRef.current !== reconnectController
        ) {
          await signerVault.removeActive()
          await established.session.close()
          return
        }
        nip46ReconnectAbortRef.current = null
        nip46SessionRef.current = established.session
        await openForPublicKey(established.record.expectedPublicKey, "nip46")
      } catch (error) {
        await established?.session.close(error)
        if (nip46ReconnectAbortRef.current === reconnectController) {
          nip46ReconnectAbortRef.current = null
        }
        if (
          reconnectController.signal.aborted ||
          error instanceof Nip46CanceledError
        ) {
          return
        }
        setState({
          phase: "nip46-unavailable",
          kind: nip46FailureKind(error),
          expectedPublicKey: signerRecord.expectedPublicKey,
          message: errorMessage(error),
        })
      }
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
  }, [
    clearDirectSigner,
    clearNip46Session,
    openForPublicKey,
    resetDirectUnlockRateLimit,
  ])

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

  const connectRemoteSigner = useCallback(async () => {
    if (nip46PairingRef.current) return
    if (walletEnvironment.nip46Relays.length === 0) {
      setState({
        phase: "nip46-pairing",
        status: "failed",
        uri: "",
        message: "No NIP-46 relays are configured for this Wallet.",
      })
      return
    }

    let pairing: Nip46Pairing
    try {
      pairing = createNip46Pairing({
        relays: walletEnvironment.nip46Relays,
        url: window.location.origin,
        onAuthorization: ({ url }) => {
          if (nip46PairingRef.current !== pairing) return
          setState({
            phase: "nip46-pairing",
            status: "awaiting-authorization",
            uri: pairing.uri,
            authorizationUrl: url,
          })
        },
      })
    } catch (error) {
      setState({
        phase: "nip46-pairing",
        status: "failed",
        uri: "",
        message: errorMessage(error),
      })
      return
    }

    nip46PairingRef.current = pairing
    setState({ phase: "nip46-pairing", status: "waiting", uri: pairing.uri })

    let established: Awaited<ReturnType<Nip46Pairing["establish"]>> | null =
      null
    try {
      established = await pairing.establish()
      if (nip46PairingRef.current !== pairing) {
        await established.session.close()
        return
      }
      setState({ phase: "nip46-pairing", status: "verified", uri: "" })
      await signerVault.saveNip46(established.record)
      if (nip46PairingRef.current !== pairing) {
        await signerVault.removeActive()
        await established.session.close()
        return
      }
      nip46PairingRef.current = null
      await clearNip46Session()
      nip46SessionRef.current = established.session
      await openForPublicKey(established.record.expectedPublicKey, "nip46")
    } catch (error) {
      if (nip46PairingRef.current === pairing) {
        nip46PairingRef.current = null
      }
      if (established) {
        await established.session.close(error)
        await signerVault.removeActive().catch(() => undefined)
      }
      if (error instanceof Nip46CanceledError) return
      setState({
        phase: "nip46-pairing",
        status: "failed",
        uri: "",
        message: errorMessage(error),
      })
    }
  }, [clearNip46Session, openForPublicKey])

  const cancelRemoteSigner = useCallback(async () => {
    const pairing = nip46PairingRef.current
    nip46PairingRef.current = null
    setState({ phase: "nip46-pairing", status: "canceling", uri: "" })
    await pairing?.cancel()
    await signerVault.removeActive()
    await clearNip46Session()
    setState({ phase: "signed-out" })
  }, [clearNip46Session])

  const openRemoteAuthorization = useCallback(() => {
    const authorizationUrl =
      state.phase === "nip46-pairing" || state.phase === "nip46-reconnecting"
        ? state.authorizationUrl
        : undefined
    if (!authorizationUrl) return
    window.open(authorizationUrl, "_blank", "noopener,noreferrer")
  }, [state])

  const rePairRemoteSigner = useCallback(async () => {
    await signerVault.removeActive()
    await clearNip46Session()
    await connectRemoteSigner()
  }, [clearNip46Session, connectRemoteSigner])

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
    nip46ReconnectAbortRef.current?.abort()
    nip46ReconnectAbortRef.current = null
    const pairing = nip46PairingRef.current
    nip46PairingRef.current = null
    await pairing?.cancel()
    const runtime = runtimeRef.current
    runtimeRef.current = null
    const remoteSession = nip46SessionRef.current
    try {
      await forgetWalletSession(
        runtime,
        signerVault,
        clearRuntimeSigners,
        remoteSession ? () => remoteSession.logout() : undefined
      )
    } finally {
      pendingDirectRecordRef.current = null
      resetDirectUnlockRateLimit()
      setState({ phase: "signed-out" })
    }
  }, [clearRuntimeSigners, resetDirectUnlockRateLimit])

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
      nip46ReconnectAbortRef.current?.abort()
      nip46ReconnectAbortRef.current = null
      const pairing = nip46PairingRef.current
      nip46PairingRef.current = null
      void pairing?.cancel()
      const runtime = runtimeRef.current
      runtimeRef.current = null
      clearDirectSigner()
      void clearNip46Session()
      void runtime?.close()
    }
  }, [clearDirectSigner, clearNip46Session, restore, runOneOpen])

  const value = useMemo<WalletRuntimeContextValue>(
    () => ({
      state,
      extensionAvailable,
      signInWithNip07,
      connectRemoteSigner,
      cancelRemoteSigner,
      openRemoteAuthorization,
      rePairRemoteSigner,
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
      cancelRemoteSigner,
      connectRemoteSigner,
      continueOpeningWallet,
      removeStrandedWallet,
      restore,
      openRemoteAuthorization,
      rePairRemoteSigner,
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
