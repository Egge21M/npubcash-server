import {
  initializeCoco,
  OperationInProgressError,
  type BalanceSnapshot,
  type Manager,
  type MintOperation,
} from "@cashu/coco-core"
import { IndexedDbRepositories } from "@cashu/coco-indexeddb"
import { mnemonicToSeed } from "@scure/bip39"
import {
  LocalStorageSinceStore,
  NPCPlugin,
  type NPCAccountApi,
} from "coco-cashu-plugin-npc"

import { walletEnvironment } from "@/config/environment"
import {
  createNpubCashSigner,
  type NostrEventSigner,
} from "@/signer/npubcash-auth"
import {
  GuardedNpubCashSinceStore,
  type NpubCashQuoteIssue,
} from "./npubcash-quote-guard"
import {
  installPinnedNPCQuoteGuard,
  PinnedNPCLogger,
  type PinnedNPCIssue,
} from "./pinned-npc-adapter"
import type { WalletInstallation } from "./wallet-registry"

interface ClosableDatabase {
  close(): void
}

export type PaymentSyncIssue = (
  | NpubCashQuoteIssue
  | PinnedNPCIssue
  | {
      kind: "offline" | "api-authorization" | "api-unavailable"
      title: string
      message: string
    }
) & { operationId?: string }

export interface PaymentClaimProjection {
  operationId: string
  mintUrl: string
  amount: number
  state: MintOperation["state"]
}

export interface PaymentClaimSuccess {
  operationId: string
  mintUrl: string
  amount: number
  completedAt: number
}

export interface PaymentSyncSnapshot {
  checking: boolean
  claims: PaymentClaimProjection[]
  issues: PaymentSyncIssue[]
  lastSuccess: PaymentClaimSuccess | null
}

const EMPTY_PAYMENT_SYNC_SNAPSHOT: PaymentSyncSnapshot = {
  checking: false,
  claims: [],
  issues: [],
  lastSuccess: null,
}

const PAYMENT_SYNC_INTERVAL_MS = 30_000
const CLAIM_RECOVERY_CONCURRENCY_WAIT_MS = 5_000

function classifyNpubCashFailure(error: unknown): PaymentSyncIssue {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      kind: "offline",
      title: "Wallet is offline",
      message: "Connect to the internet to check npub.cash and claim payments.",
    }
  }
  const statusCode =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 0
  const message = error instanceof Error ? error.message : ""
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /authoriz|signer|signature|different public key|reject|denied/i.test(
      message
    )
  ) {
    return {
      kind: "api-authorization",
      title: "npub.cash authorization failed",
      message:
        "The Nostr Signer could not authorize this payment check. Reconnect the signer and try again.",
    }
  }
  return {
    kind: "api-unavailable",
    title: "npub.cash is unavailable",
    message:
      "The Wallet could not check for payments. It will try again while you are online.",
  }
}

export class WalletRuntime {
  private closePromise: Promise<void> | null = null
  private syncPromise: Promise<void> | null = null
  private projectionPromise: Promise<void> = Promise.resolve()
  private paymentSyncState: PaymentSyncSnapshot = EMPTY_PAYMENT_SYNC_SNAPSHOT
  private quoteIssues: PaymentSyncIssue[] = []
  private runtimeIssue: PaymentSyncIssue | null = null
  private readonly paymentSyncListeners = new Set<() => void>()
  private readonly eventUnsubscribers: Array<() => void> = []
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  readonly coco: Manager
  private readonly database: ClosableDatabase
  private readonly npubCashAccount?: NPCAccountApi

  constructor(
    coco: Manager,
    database: ClosableDatabase,
    npubCashAccount?: NPCAccountApi
  ) {
    this.coco = coco
    this.database = database
    this.npubCashAccount = npubCashAccount
  }

  balance(): Promise<BalanceSnapshot> {
    return this.coco.wallet.balances.total({ trustedOnly: true })
  }

  async recoverClaim(operationId: string): Promise<MintOperation | null> {
    const operation = await this.coco.ops.mint.get(operationId)
    if (
      !operation ||
      (operation.state !== "pending" && operation.state !== "executing")
    ) {
      return operation
    }

    try {
      await this.coco.ops.mint.refresh(operationId)
    } catch (error) {
      let latest = await this.coco.ops.mint.get(operationId)
      if (!latest) throw error
      if (latest.state !== operation.state) return latest
      if (error instanceof OperationInProgressError) {
        const waitUntil = Date.now() + CLAIM_RECOVERY_CONCURRENCY_WAIT_MS
        while (
          this.coco.ops.mint.diagnostics.isLocked(operationId) &&
          Date.now() < waitUntil
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        if (this.coco.ops.mint.diagnostics.isLocked(operationId)) throw error
        latest = await this.coco.ops.mint.get(operationId)
        if (!latest) throw error
        return latest
      }
      throw error
    }

    return this.coco.ops.mint.get(operationId)
  }

  npubCashAccountCount(): number {
    return this.coco.ext.npc.listAccounts().length
  }

  paymentSyncSnapshot(): PaymentSyncSnapshot {
    return this.paymentSyncState
  }

  subscribePaymentSync(listener: () => void): () => void {
    this.paymentSyncListeners.add(listener)
    return () => this.paymentSyncListeners.delete(listener)
  }

  syncPayments(): Promise<void> {
    if (!this.npubCashAccount || this.closed) return Promise.resolve()
    this.syncPromise ??= (async () => {
      this.runtimeIssue = null
      this.updatePaymentSync({ checking: true })
      try {
        await this.npubCashAccount!.sync()
        await this.refreshPaymentProjection()
      } finally {
        this.updatePaymentSync({ checking: false })
      }
    })().finally(() => {
      this.syncPromise = null
    })
    return this.syncPromise
  }

  attachPaymentSync(): void {
    if (!this.npubCashAccount || this.eventUnsubscribers.length > 0) return
    const refresh = () => void this.refreshPaymentProjection()
    this.eventUnsubscribers.push(
      this.coco.on("mint-op:pending", refresh),
      this.coco.on("mint-op:executing", refresh),
      this.coco.on("mint-op:failed", refresh),
      this.coco.on("proofs:saved", refresh),
      this.coco.on("mint-op:finalized", ({ operation }) => {
        this.updatePaymentSync({
          lastSuccess: {
            operationId: operation.id,
            mintUrl: operation.mintUrl,
            amount: operation.amount.toNumber(),
            completedAt: operation.updatedAt,
          },
        })
        refresh()
      })
    )
    if (typeof window !== "undefined") {
      this.pollingTimer = window.setInterval(
        () => void this.syncPayments(),
        PAYMENT_SYNC_INTERVAL_MS
      )
    }
  }

  reportQuoteInspection(issues: NpubCashQuoteIssue[]): void {
    this.quoteIssues = issues
    this.updatePaymentSync({ issues: this.allIssues() })
  }

  reportNpubCashFailure(error: unknown): void {
    this.runtimeIssue = classifyNpubCashFailure(error)
    this.updatePaymentSync({ issues: this.allIssues() })
  }

  reportNPCIssue(issue: PinnedNPCIssue): void {
    if (
      this.runtimeIssue?.kind === "offline" ||
      this.runtimeIssue?.kind === "api-authorization" ||
      this.runtimeIssue?.kind === "api-unavailable"
    ) {
      return
    }
    this.runtimeIssue = issue
    this.updatePaymentSync({ issues: this.allIssues() })
  }

  refreshPaymentProjection(): Promise<void> {
    this.projectionPromise = this.projectionPromise
      .catch(() => undefined)
      .then(async () => {
        if (this.closed) return
        const [inFlight, history] = await Promise.all([
          this.coco.ops.mint.listInFlight(),
          this.coco.history.getPaginatedHistory(0, 200),
        ])
        const failedClaims: PaymentSyncIssue[] = history
          .filter((entry) => entry.type === "mint" && entry.state === "failed")
          .map((entry) => ({
            kind: "claim-failed" as const,
            title: "Payment claim failed",
            message:
              "Coco retained this failed claim so it can be understood and recovered safely.",
            operationId: entry.operationId,
          }))
        const claims = inFlight.map((operation) => ({
          operationId: operation.id,
          mintUrl: operation.mintUrl,
          amount: operation.amount.toNumber(),
          state: operation.state,
        }))
        this.updatePaymentSync({
          claims,
          issues: [...this.allIssues(), ...failedClaims],
        })
      })
    return this.projectionPromise
  }

  private allIssues(): PaymentSyncIssue[] {
    return [
      ...this.quoteIssues,
      ...(this.runtimeIssue ? [this.runtimeIssue] : []),
    ]
  }

  private updatePaymentSync(update: Partial<PaymentSyncSnapshot>): void {
    this.paymentSyncState = { ...this.paymentSyncState, ...update }
    for (const listener of this.paymentSyncListeners) listener()
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closed = true
      if (this.pollingTimer !== null) {
        clearInterval(this.pollingTimer)
        this.pollingTimer = null
      }
      for (const unsubscribe of this.eventUnsubscribers.splice(0)) {
        unsubscribe()
      }
      try {
        await this.coco.dispose()
      } finally {
        this.database.close()
      }
    })()
    return this.closePromise
  }
}

export async function openWalletRuntime(
  installation: WalletInstallation,
  signer: NostrEventSigner
): Promise<WalletRuntime> {
  const repositories = new IndexedDbRepositories({
    name: installation.databaseName,
  })
  const seed = await mnemonicToSeed(installation.recoveryPhrase)
  let manager: Manager | null = null
  let runtime: WalletRuntime | null = null
  const npcPlugin = new NPCPlugin({
    defaultBaseUrl: walletEnvironment.apiOrigin,
    logger: new PinnedNPCLogger((issue) => runtime?.reportNPCIssue(issue)),
  })

  try {
    manager = await initializeCoco({
      repo: repositories,
      seedGetter: async () => seed,
      plugins: [npcPlugin],
    })
    const sinceStore = new GuardedNpubCashSinceStore(
      new LocalStorageSinceStore(
        `npubcash:npc-since:v1:${installation.publicKey}`
      )
    )
    const account = await manager.ext.npc.addAccount({
      id: installation.publicKey,
      signer: createNpubCashSigner(installation.publicKey, signer),
      sinceStore,
      autoStart: true,
      useWebsocket: false,
    })
    runtime = new WalletRuntime(manager, repositories.db, account)
    installPinnedNPCQuoteGuard(account, sinceStore, {
      checking: () => undefined,
      inspected: (issues) => runtime?.reportQuoteInspection(issues),
      failed: (error) => runtime?.reportNpubCashFailure(error),
    })
    runtime.attachPaymentSync()
    await runtime.refreshPaymentProjection()
    return runtime
  } catch (error) {
    await manager?.dispose().catch(() => undefined)
    repositories.db.close()
    throw error
  }
}
