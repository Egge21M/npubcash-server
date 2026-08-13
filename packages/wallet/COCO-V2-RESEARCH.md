# Coco v2 RC and NPC nightly research

Verified against first-party npm metadata and source on **2026-08-12**. This
note describes the deliberately unstable dependency line selected for the new
wallet. It does not prescribe wallet product behavior.

## Compatibility verdict

The newest Coco RC and the current NPC nightly are **not one compatible set**.
The three Coco `rc` tags now point to `2.0.0-rc.3`, while the NPC nightly has an
exact peer dependency on `@cashu/coco-core@2.0.0-rc.1`. Installing both moving
tags therefore produces a peer mismatch. [Coco core registry
metadata](https://registry.npmjs.org/%40cashu%2Fcoco-core), [NPC plugin registry
metadata](https://registry.npmjs.org/coco-cashu-plugin-npc)

| Package | Current npm tags | Plugin-compatible pin | Relevant declared compatibility |
| --- | --- | --- | --- |
| `@cashu/coco-core` | `latest: 1.0.1`, `rc: 2.0.0-rc.3` | `2.0.0-rc.1` | TypeScript `^5`; depends on `@cashu/cashu-ts: 4.5` |
| `@cashu/coco-indexeddb` | `latest: 1.0.1`, `rc: 2.0.0-rc.3` | `2.0.0-rc.1` | exact core `2.0.0-rc.1`, cashu-ts `4.5`, TypeScript `^5` |
| `@cashu/coco-react` | `latest: 1.0.1`, `rc: 2.0.0-rc.3` | `2.0.0-rc.1` | exact core `2.0.0-rc.1`, React `^19` |
| `coco-cashu-plugin-npc` | `latest: 2.4.1`, `nightly: 3.0.0-rc.20260707.3.1.sha.debd5dd` | `3.0.0-rc.20260707.3.1.sha.debd5dd` | exact core `2.0.0-rc.1`, TypeScript `^5`; depends on `npubcash-sdk:^0.3.2` |

These constraints come from the exact published manifests: [core
RC1](https://registry.npmjs.org/%40cashu%2Fcoco-core/2.0.0-rc.1), [IndexedDB
RC1](https://registry.npmjs.org/%40cashu%2Fcoco-indexeddb/2.0.0-rc.1), [React
RC1](https://registry.npmjs.org/%40cashu%2Fcoco-react/2.0.0-rc.1), and [NPC
nightly](https://registry.npmjs.org/coco-cashu-plugin-npc/3.0.0-rc.20260707.3.1.sha.debd5dd).
The nightly version identifies upstream commit
[`debd5ddf`](https://github.com/Egge21M/coco-cashu-plugin-npc/commit/debd5ddf6213cdc56a464e8d05c53ad57e6c527b).

The reproducible package tuple is therefore:

```json
{
  "dependencies": {
    "@cashu/coco-core": "2.0.0-rc.1",
    "@cashu/coco-indexeddb": "2.0.0-rc.1",
    "@cashu/coco-react": "2.0.0-rc.1",
    "coco-cashu-plugin-npc": "3.0.0-rc.20260707.3.1.sha.debd5dd"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

The wallet's current TypeScript `~6` declaration does not satisfy these peers.
TypeScript `5.9.3` is the last published 5.x release and satisfies `^5`.
[TypeScript registry metadata](https://registry.npmjs.org/typescript)

Core RC1's `4.5` cashu-ts dependency currently resolves to `4.5.1`. The local
`npubcash-sdk@0.3.2`, which satisfies the plugin dependency, independently uses
cashu-ts `^3.2.2`. Two cashu-ts majors in the lockfile are therefore expected;
do not force a single version with a global override. [Core RC1
manifest](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/package.json),
[npubcash SDK manifest](../sdk/package.json)

## Browser persistence, seed, and React

`@cashu/coco-indexeddb` exposes `new IndexedDbRepositories({ name })`. Its
default database name is `coco_cashu`; passing `name` is the supported way to
isolate a database per Nostr public key. `initializeCoco()` calls `repo.init()`
and then starts Coco's configured plugins, watchers, processors, and recovery.
[IndexedDB RC1 README](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/indexeddb/README.md),
[IndexedDB implementation](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/indexeddb/src/index.ts),
[manager initialization](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/Manager.ts)

Coco does not persist the wallet seed. `seedGetter` must repeatedly return the
same 64-byte `Uint8Array`; core validates the type and length. The React package's
`localStorageSeedGetter({ storageKey })` creates 64 random bytes with Web Crypto,
stores them as base64 in localStorage, and caches them for that getter instance.
The wallet can therefore use separate, public-key-derived database and seed keys.
[Seed service](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/services/SeedService.ts),
[localStorage seed helper](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/react/src/lib/utils/localStorageSeedGetter.ts)

One important invariant is not supplied by the helper: if a seed entry is
missing, it silently creates a new seed. The application must distinguish "new
wallet" from "existing public-key database whose seed disappeared" before Coco
starts; silently attaching a replacement seed to an existing database would
break deterministic recovery and future output derivation.

RC1's helper also has a first-open cross-tab race: two tabs can both observe no
seed, generate different values, and overwrite the same localStorage key. RC3
adds browser locking, but cannot be substituted while the NPC nightly peers on
RC1. The RC1 integration must therefore serialize first-time wallet creation
with an application-owned Web Lock (or explicitly prevent a concurrent first
open). [RC1 seed helper](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/react/src/lib/utils/localStorageSeedGetter.ts),
[RC3 seed helper](https://github.com/cashubtc/coco/blob/v2.0.0-rc.3/packages/react/src/lib/utils/localStorageSeedGetter.ts)

`CocoCashuProvider` can either initialize from a `CocoConfig` or accept an
already initialized `Manager`. It disposes a manager that it creates. Its config
is initial-only, so switching public keys requires remounting it with a new React
`key`. Operation hooks bind to one durable operation and expose its persisted
state: `useSendOperation`, `useReceiveOperation`, `useMintOperation`, and
`useMeltOperation`; balance, trusted-mint, and paginated-history hooks are also
provided. [React RC1 README](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/react/README.md),
[provider source](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/react/src/lib/providers/root.tsx),
[operation hooks](https://github.com/cashubtc/coco/tree/v2.0.0-rc.1/packages/react/src/lib/hooks)

`manager.dispose()` stops manager-owned watchers, processors, subscriptions, and
plugins, but it does not close the adapter's Dexie connection. A lifecycle owner
that switches identities should dispose the manager and then call
`repositories.db.close()` before opening the next public-key database. Passing
an app-owned manager to the React provider makes that ordering explicit.
[Manager disposal](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/Manager.ts),
[IndexedDB repository bundle](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/indexeddb/src/index.ts)

A minimal integration shape is:

```ts
const walletId = nostrPubkey.toLowerCase()
const repo = new IndexedDbRepositories({ name: `npubcash-wallet:${walletId}` })
const seedGetter = localStorageSeedGetter({
  storageKey: `npubcash:coco-seed:v1:${walletId}`,
})
const npcPlugin = new NPCPlugin({
  defaultBaseUrl: NPC_BASE_URL,
  sinceStoreFactory: (accountId) =>
    new LocalStorageSinceStore(`npubcash:npc-since:v1:${accountId}`),
})

const manager = await initializeCoco({
  repo,
  seedGetter,
  plugins: [npcPlugin],
})

const npcAccount = await manager.ext.npc.addAccount({
  id: walletId,
  signer,
  autoStart: true,
  useWebsocket: true,
})
```

The shipped NPC README examples currently say `core.extensions.npc`, but Coco
RC1's actual typed manager property is `manager.ext`. Treat `manager.ext.npc` as
the authoritative API and keep a compile-time smoke test for it. [Coco manager
API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/Manager.ts),
[NPC nightly README](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/README.md)

## NPC account and claim behavior

The nightly is the v3, multi-account plugin API. `NPCPlugin` may be initialized
with no accounts, after which `manager.ext.npc.addAccount()` activates one
runtime. The signer is the npub.cash SDK signing callback—an event template in,
a signed Nostr event out. `NPCAccountStore` persists metadata only; it never
persists signer material and stored records are not automatically activated.
The host must restore the signer and call `addAccount()` again. [Plugin public
types](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/types.ts),
[plugin API](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/PluginApi.ts),
[SDK signer type](../sdk/src/types.ts)

Each account needs a durable `SinceStore`. Resolution order is an explicit store,
the plugin's per-account factory, then an in-memory store. Interval polling is
disabled when no interval is supplied; WebSocket updates are opt-in. WebSockets
trigger the same sync pipeline, reconnect with backoff, and pause/resume with the
Coco manager. [Since stores](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/sync/sinceStore.ts),
[account runtime](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts)

`account.sync()` currently combines discovery and claiming; it does not return a
list of pending claims. The pipeline:

1. Reads the account's paid-at watermark and calls `NPCClient.getQuotesSince()`.
2. Drops malformed, invalid-URL, and already-watermarked quotes.
3. Groups by mint, adds each mint as trusted, and transforms each record into a
   paid BOLT11 canonical mint quote.
4. Imports the quote into Coco, prepares a mint operation, and executes it so the
   mint issues proofs.
5. Advances the watermark only through the highest timestamp before the first
   unresolved failure.

`account.getQuotesSince()` is the separate raw-inspection API. The sync method
returns `Promise<void>` and catches/logs per-quote failures, so successful return
must not be interpreted as "every quote is available"; Coco quote/operation
state and events are the authoritative progress source. [Runtime sync
implementation](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts),
[sync tests](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/tests/syncPaidQuotes.test.ts)

Two other current contracts need to be explicit in the application boundary:

- Sync marks every mint URL supplied by npub.cash as trusted without prompting.
  Any allowlist or confirmation requirement must be enforced outside the plugin.
- Re-adding an existing account ID is idempotent only when the signer and an
  explicitly supplied `SinceStore` are the same object references. Recreating
  either on React renders is treated as different configuration and throws.
  Account runtime objects therefore belong in the wallet lifecycle, not render
  code.

[Account runtime trust/import path](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts),
[account registration](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/plugins/NPCPlugin.ts)

The pipeline is retry-oriented: syncs are serialized per account; an existing
non-`init` mint operation for `(mintUrl, quoteId)` is skipped; an existing `init`
operation is resumed; and a failure prevents the watermark from moving past it.
Coco RC1 also enforces canonical `(mintUrl, quoteId)` quote identity and persists
mint operations. Together these make retries safe at the application boundary,
although end-to-end crash/retry tests remain mandatory. [NPC runtime](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts),
[Coco v2 changelog](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/CHANGELOG.md)

The `init` resume path probes and calls Coco's non-public
`prepareInitOperation()` service method. That private coupling is another reason
the plugin/core pair must remain exact. The cursor is also timestamp-only and
filters `paidAt <= since`; compatibility tests must confirm the npub.cash server
never makes a new quote appear later with an already-completed timestamp, or it
would be skipped. [NPC resume and watermark
implementation](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts)

## Ecash send, Lightning melt, and recovery

An ecash send is a durable two-step operation. `prepare()` reserves inputs and
exposes the operation/fee state; `execute()` returns both the pending operation
and a `Token`, which can be encoded for sharing. Pending sends can later be
refreshed, explicitly finalized, or reclaimed where safe.
[Send API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/SendOpsApi.ts)

```ts
const prepared = await manager.ops.send.prepare({ mintUrl, amount: 100 })
const { operation, token } = await manager.ops.send.execute(prepared.id)
const encoded = manager.wallet.encodeToken(token)
```

A BOLT11 payment first creates a canonical melt quote, then prepares and executes
the melt operation. `amountSats` is optional for amountless invoices. Execution
may be finalized or pending; the quote watcher and settlement processor reconcile
pending results.
[Quote API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/QuoteApi.ts),
[Melt API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/MeltOpsApi.ts),
[BOLT11 handler](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/infra/handlers/melt/MeltBolt11Handler.ts)

```ts
const quote = await manager.quotes.melt.create({
  mintUrl,
  method: "bolt11",
  methodData: { invoice },
})
const prepared = await manager.ops.melt.prepare({ quote })
const result = await manager.ops.melt.execute(prepared.id)
```

IndexedDB persists proofs, canonical quotes, history projections, and send,
receive, mint, and melt operations. On initialization, RC1 enables configured
watchers/processors and runs startup recovery for sends, melts, pending mint
operations, and payment-request receive attempts. A manual
`manager.ops.receive.recovery.run()` API also exists, but RC1's initializer does
not call that generic receive sweep. [Manager startup](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/Manager.ts),
[receive recovery](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/ReceiveOpsApi.ts),
[IndexedDB schema](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/indexeddb/src/lib/schema.ts)

The newer RCs contain material fixes that are absent from the plugin-compatible
RC1: RC2 serializes concurrent receives per mint; RC3 makes explicit mint
execution retry-safe when background processing already started or completed it,
changes canonical quote accounting, moves to cashu-ts 5 RC, and advances the
IndexedDB schema. These are reasons to test the RC1 mint-processor/plugin race and
to upgrade the whole tuple—not reasons to ignore the plugin's exact peer.
[RC3 changelog](https://github.com/cashubtc/coco/blob/v2.0.0-rc.3/packages/core/CHANGELOG.md),
[RC1-to-RC3 comparison](https://github.com/cashubtc/coco/compare/v2.0.0-rc.1...v2.0.0-rc.3)

## On-chain status

Coco v2 RC1 already ships NUT-30 on-chain mint and melt handlers. On-chain melt
quote creation accepts an address and amount; the returned quote exposes fee
options, and operation preparation requires selecting `feeIndex`. Settlement is
asynchronous and still depends on the chosen mint advertising/supporting the
method. This capability can remain unused without changing the Lightning/ecash
integration described above. [Coco RC1 changelog](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/CHANGELOG.md),
[on-chain melt handler](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/infra/handlers/melt/MeltOnchainHandler.ts),
[NUT-30](https://github.com/cashubtc/nuts/blob/main/30.md)

## Reloading send routes and recovering the presented ecash token

For an ordinary successful `default` ecash send, RC1 persists enough to present
the same token again after a page reload. Execution builds the `Token`, applies
the optional memo, embeds it in the `PendingSendOperation`, writes that pending
operation to the repository, and only then emits `send:pending` and returns to
the caller. The IndexedDB adapter stores the complete token as `tokenJson` and
rehydrates proof amounts when `manager.ops.send.get(operationId)` reads it.
[Send execution ordering](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/operations/send/SendOperationService.ts),
[default send token construction](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/infra/handlers/send/DefaultSendHandler.ts),
[IndexedDB send repository](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/indexeddb/src/repositories/SendOperationRepository.ts)

The public reconstruction path is therefore:

```ts
const operation = await manager.ops.send.get(operationId)
if (operation?.state === "pending" && operation.token) {
  const encoded = manager.wallet.encodeToken(operation.token)
}
```

`encodeToken()` delegates to cashu-ts's deterministic v4 CBOR encoder. The
persisted token retains proof order, signatures, secrets, DLEQ/witness data,
unit, and memo, so using the same pinned encoder and the same `removeDleq` option
reproduces the same `cashuB...` string. [Wallet encode
API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/WalletApi.ts),
[cashu-ts 4.5.1 encoder](https://github.com/cashubtc/cashu-ts/blob/89549ba9c7066702e32128875baf1eac678277aa/src/utils/core.ts)

A separate encoded-token record is **not required** for the Cashu payload of a
normally returned send. An app record is still appropriate for presentation
metadata that Coco does not own—such as copied/shared state, chosen encoding
options, or a URI wrapper. If the application supports more than one encoding
option, that choice must be stored or fixed by policy to reproduce the exact
presentation string.

The operation model nevertheless makes `token` optional. A crash can leave an
`executing` operation before the pending token write, and handler recovery may
legitimately lack a reconstructable token. Prepared output data contains secrets
and blinding material, but not the issued signatures; the proof repository may
hold relevant proofs, but Coco exposes no public "rebuild token from operation"
API. A pending operation with no token must therefore be treated as a recovery
exception. Do not reconstruct it from adapter internals and do not call
`execute()` again. [Send operation model](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/operations/send/SendOperation.ts),
[send recovery contract](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/operations/send/SendMethodHandler.ts)

Safe route resumption after `initializeCoco()` completes:

| Persisted state | `/send/ecash/:operationId` | `/send/lightning/:operationId` |
| --- | --- | --- |
| missing or wrong method | Show not found/invalid; never create a replacement implicitly | Same; require `method === "bolt11"` |
| `prepared` | Restore the review screen; call `execute(id)` only on explicit confirmation | Restore invoice/fee review; call `execute(id)` only on confirmation |
| `executing` | Show reconciling; invoke the global `send.recovery.run()` for an explicit retry, then re-read. Never execute again | Call `melt.refresh(id)`, which runs executing recovery, then re-read. Never execute again |
| `pending` | If `token` exists, encode and present it; `refresh(id)` may detect recipient spend and finalize it. If absent, show a recovery exception and only offer safe reconciliation/reclaim actions | Show payment pending and use `refresh(id)`; never submit a second melt or quote |
| `finalized` | Show completed/claimed; do not offer the token as a new send | Show receipt and persisted settlement data |
| `rolled_back` / `failed` | Show cancelled/failed; starting over is a new explicit operation | Same |
| `rolling_back` | Show a recovery-required state. RC1 startup recovery only warns about this state | Same; do not retry payment |

The APIs enforce the most important guard: both send and melt `execute()` reload
the latest persisted operation and reject every state except `prepared`.
`initializeCoco()` runs startup send and melt recovery before returning, while
send `refresh()` only checks `pending` and melt `refresh()` checks both `pending`
and `executing`. Routes should render from the returned operation state (or bind
the corresponding React operation hook by ID), not from navigation state, and
must never create a new operation merely because a result object was lost during
navigation. [Send public API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/SendOpsApi.ts),
[melt public API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/MeltOpsApi.ts),
[manager startup recovery](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/Manager.ts),
[send startup recovery](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/operations/send/SendOperationService.ts)

## Pinning and compatibility-test policy

1. Commit exact versions shown above and the generated `bun.lock`. Never write
   `@rc`, `@nightly`, caret, or tilde ranges for these four packages. The plugin's
   nightly publishing workflow moves the `nightly` tag on every eligible publish.
   [Nightly workflow](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/.github/workflows/nightly-release.yml)
2. Use a pinned Bun version in CI and `bun install --frozen-lockfile`. Treat a
   lockfile diff involving Coco, cashu-ts, npubcash-sdk, Dexie, or the NPC plugin
   as an explicit dependency upgrade.
3. Upgrade all three Coco packages together. Upgrade beyond core RC1 only after
   an NPC release declares that exact core peer. Do not use `--force` or suppress
   the peer mismatch.
4. Preserve two cashu-ts majors until the SDK migrates. Do not add a root override
   that coerces SDK v3 types/runtime onto Coco's v4 dependency.
5. Before an IndexedDB adapter upgrade, retain fixtures produced by the old
   version. Test forward migration with real balances and in-flight operations;
   do not assume that a browser database opened by a newer RC can be safely
   reopened by an older one.
6. Gate every tuple upgrade on Chromium integration tests covering:
   - public-key-isolated database, seed key, and NPC watermark;
   - cold start, reload, sign-out/sign-in, missing-seed refusal, and concurrent
     first open in two tabs;
   - one paid npub.cash quote imported/redeemed exactly once across repeated sync,
     WebSocket plus polling overlap, and failure/retry;
   - crashes after quote import, operation prepare, execute, and proof persistence;
   - ecash prepare/execute/encode, pending reload, finalize, and reclaim;
   - BOLT11 finalized and pending outcomes, restart settlement, and safe rollback;
   - manager disposal followed by Dexie close before public-key switching;
   - compile-time `manager.ext.npc` augmentation and React hook types;
   - `bun install --frozen-lockfile`, typecheck, production build, and zero invalid
     peer-dependency diagnostics.
