import {
  initializeCoco,
  type BalanceSnapshot,
  type Manager,
} from "@cashu/coco-core"
import { IndexedDbRepositories } from "@cashu/coco-indexeddb"
import { mnemonicToSeed } from "@scure/bip39"
import { NPCPlugin } from "coco-cashu-plugin-npc"

import { walletEnvironment } from "@/config/environment"
import type { WalletInstallation } from "./wallet-registry"

interface ClosableDatabase {
  close(): void
}

export class WalletRuntime {
  private closePromise: Promise<void> | null = null
  readonly coco: Manager
  private readonly database: ClosableDatabase

  constructor(coco: Manager, database: ClosableDatabase) {
    this.coco = coco
    this.database = database
  }

  balance(): Promise<BalanceSnapshot> {
    return this.coco.wallet.balances.total({ trustedOnly: true })
  }

  npubCashAccountCount(): number {
    return this.coco.ext.npc.listAccounts().length
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
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
  installation: WalletInstallation
): Promise<WalletRuntime> {
  const repositories = new IndexedDbRepositories({
    name: installation.databaseName,
  })
  const seed = await mnemonicToSeed(installation.recoveryPhrase)
  const npcPlugin = new NPCPlugin({
    defaultBaseUrl: walletEnvironment.apiOrigin,
  })

  try {
    const manager = await initializeCoco({
      repo: repositories,
      seedGetter: async () => seed,
      plugins: [npcPlugin],
    })
    return new WalletRuntime(manager, repositories.db)
  } catch (error) {
    repositories.db.close()
    throw error
  }
}
