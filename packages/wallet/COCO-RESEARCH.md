# Coco research for the npub.cash Claim Companion

Verified against first-party sources on 2026-08-12. This note describes the
latest stable Coco release (`v1.0.1`), not unreleased `master` behavior.

## Conclusions

- Build against the stable, namespaced packages: `@cashu/coco-core`,
  `@cashu/coco-indexeddb`, and optionally `@cashu/coco-react`, all pinned to the
  same version. Coco `v1.0.1` is the current GitHub release, and its packages
  declare TypeScript 5; the new wallet currently declares TypeScript 6, so that
  dependency needs to be reconciled before integration. [Coco v1.0.1
  release](https://github.com/cashubtc/coco/releases/tag/v1.0.1), [core package
  manifest](https://github.com/cashubtc/coco/blob/v1.0.1/packages/core/package.json),
  [React package manifest](https://github.com/cashubtc/coco/blob/v1.0.1/packages/react/package.json)
- Coco owns the local Cashu wallet, deterministic wallet recovery, persisted
  operation state, and mint interactions. It does **not** own npub.cash identity
  login, NIP-07, local `nsec` handling, or NIP-46 remote-signer sessions.
- Ecash token sending and BOLT11 Lightning payment are supported by stable Coco.
  On-chain Bitcoin payment is specified by optional NUT-30 but is not a built-in
  `v1.0.1` operation handler. On-chain must therefore be feature-gated until a
  compatible Coco release/handler and a supporting mint are available.
- The published `coco-cashu-plugin-npc@2.4.1` is not compatible with the stable
  namespaced release: it peers on `coco-cashu-core@^1.1.2-rc.50`, while stable
  Coco is `@cashu/coco-core@1.0.1`. The plugin must be ported/published for the
  stable API, or the app must implement the small npub.cash-to-Coco bridge itself.
  [Published plugin metadata](https://registry.npmjs.org/coco-cashu-plugin-npc/2.4.1),
  [published plugin README](https://www.npmjs.com/package/coco-cashu-plugin-npc)

## Stable package architecture

| Layer | Stable package | Role in this browser app |
| --- | --- | --- |
| Headless wallet | `@cashu/coco-core@1.0.1` | `Manager`, wallet and mint APIs, durable operation state machines, events, recovery, and repository contracts |
| Browser persistence | `@cashu/coco-indexeddb@1.0.1` | IndexedDB implementation of Coco's repositories |
| React integration | `@cashu/coco-react@1.0.1` | Providers and hooks over a `Manager`; optional because core remains the canonical API |

The `Manager` is the app-facing facade. The supported lifecycle APIs live under
`manager.ops.send`, `.receive`, `.mint`, and `.melt`; `@cashu/coco-react`
mirrors those APIs with operation hooks. The core is deliberately headless and
storage-agnostic, while plugins can consume selected services and expose custom
APIs through `manager.ext`. [Coco repository architecture](https://github.com/cashubtc/coco/tree/v1.0.1#architecture),
[core v1.0.1 README](https://github.com/cashubtc/coco/blob/v1.0.1/packages/core/README.md),
[React overview](https://cashubtc.github.io/coco/pages/react-overview.html),
[plugin model](https://cashubtc.github.io/coco/pages/plugins.html)

For this project, Coco should sit below application services and React:

```text
React screens and view models
  -> Claim Companion application services
       -> npub.cash account/signer adapter
       -> npub.cash quote-sync adapter
       -> Coco Manager (Cashu operations)
            -> IndexedDB repositories
            -> mint HTTP/WebSocket APIs
```

This keeps Nostr session replacement or a future plugin migration from changing
wallet-domain code.

## Persistence, seed, and recovery boundaries

`@cashu/coco-indexeddb` persists mints, keysets, counters, proofs, mint and melt
quotes, history, key-ring entries, Cashu mint-auth sessions, and send/receive/
mint/melt operations. Repository initialization creates or migrates its schema,
and transactions span the repository set. [Storage adapter docs](https://cashubtc.github.io/coco/pages/storage-adapters.html),
[IndexedDB v1.0.1 source](https://github.com/cashubtc/coco/tree/v1.0.1/packages/indexeddb)

Coco deliberately does **not** persist the wallet seed. The app supplies a
deterministic BIP-39 seed through `seedGetter` whenever Coco needs it. In a
fully client-side app, seed generation, encrypted-at-rest storage/unlocking,
backup display, import, and deletion are therefore application responsibilities.
[Coco BIP-39 docs](https://cashubtc.github.io/coco/pages/bip39.html)

`manager.wallet.restore(mintUrl)` uses the supplied seed to scan all available
keysets at a named mint, restore deterministic proofs and counters, and add and
trust that mint. The underlying NUT-09 restore protocol is optional for mints.
It recovers blind signatures/proofs previously issued for deterministic outputs;
it is not a general cloud backup. [Coco BIP-39 restore](https://cashubtc.github.io/coco/pages/bip39.html#restore),
[NUT-09 restore specification](https://cashubtc.github.io/nuts/09/)

Consequences for the design:

- Recovery needs both the seed and the set of mint URLs to scan. The seed alone
  does not discover which mints the user used.
- Seed restore recovers spendable deterministic proofs where the mint supports
  NUT-09. It does not recreate npub.cash login state, NIP-46 client credentials,
  the quote-sync watermark, local labels, or the complete local history. This is
  an inference from the separate Coco repository contracts and restore API.
- Coco's startup recovery is different from seed recovery. With an intact
  IndexedDB, `initializeCoco()` recovers in-flight send, receive, mint, and melt
  operations from their persisted state. [watcher/recovery docs](https://cashubtc.github.io/coco/pages/watchers-processors.html),
  [send recovery](https://cashubtc.github.io/coco/pages/send-operations.html#crash-recovery),
  [mint recovery](https://cashubtc.github.io/coco/pages/mint-operations.html#recovery)
- The wallet seed and the Nostr identity key are separate secrets with separate
  lifecycles. A signer proves which npub.cash account to query; the Coco seed
  controls recovered Cashu outputs. Signing in as a pubkey must never silently
  generate a replacement seed for an existing local wallet.

## Payment flows and terminology

### Discovering and claiming npub.cash payments

npub.cash exposes authenticated, paginated quote history and realtime quote-ID
notifications. Its returned records are mint quotes with states including
`PAID`, `INFLIGHT`, and `ISSUED`; its SDK accepts a generic Nostr event-signing
function and authenticates HTTP with short-lived JWTs derived from NIP-98.
[SDK client](../sdk/src/client.ts), [quote API types](../types/src/wallet.ts),
[server quote states](../server/src/domain/mintQuote/MintQuote.ts)

The user-facing word **claim** should map to this precise pipeline:

1. **Discover** paid/issued npub.cash mint quotes using initial pagination,
   incremental `since` synchronization, and websocket invalidation.
2. **Import** each external quote into a durable Coco mint operation. In stable
   Coco this is `manager.ops.mint.importQuote(...)`.
3. **Redeem/finalize** a paid quote at its mint. Coco transitions the local mint
   operation through `pending -> executing -> finalized` and stores or restores
   the issued proofs.
4. Treat an already `ISSUED` quote as a reconciliation/recovery case, not as a
   new claim. The bridge must be idempotent by `(mintUrl, quoteId)`.

Coco itself does not discover npub.cash quotes. The currently published NPC
plugin implements polling, websocket updates, a persistent `SinceStore`
interface, quote grouping, safe watermark advancement, and forwarding into
Coco. Those behaviors remain the right contract for a stable-API port. [NPC
plugin README](https://www.npmjs.com/package/coco-cashu-plugin-npc), [Coco mint
operation lifecycle](https://cashubtc.github.io/coco/pages/mint-operations.html)

### Sending ecash

Use `manager.ops.send.prepare()` to reserve proofs and expose the fee, followed
by `execute()` to create the encoded token. The operation remains `pending`
until the recipient spends it; Coco's proof watcher can finalize it, and an
unclaimed token can be reclaimed with a fee. Persist and render the operation ID
rather than keeping token state only in a component. [Coco send operations](https://cashubtc.github.io/coco/pages/send-operations.html)

### Paying Lightning

In Coco terminology, paying a BOLT11 invoice is a **melt**, not an ecash send.
`manager.ops.melt.prepare()` creates the quote, reserves proofs, and calculates
fee reserve/swap cost; `execute()` may return either `finalized` or `pending`,
and pending results must be reconciled. Stable `v1.0.1` has a built-in handler
only for `bolt11`. [Coco melt operations](https://cashubtc.github.io/coco/pages/melt-operations.html)

### Paying on-chain Bitcoin

NUT-30 defines `onchain` mint and melt quotes. An on-chain melt is always
asynchronous, offers fee/confirmation choices, and remains `PENDING` while the
mint broadcasts and confirms the transaction. Support is optional and must be
advertised by the mint. [NUT-30 on-chain payment method](https://cashubtc.github.io/nuts/30/)

Stable Coco `v1.0.1` does not ship an on-chain handler: its documentation says
the built-in melt handler covers only `bolt11`. Although current `master` source
contains newer on-chain work, the Claim Companion should not design against it
until it is part of a compatible release. The UI should model payment rails as
capabilities and hide/disable on-chain for mints or Coco versions that cannot
execute it.

## Nostr signers and NIP-46

Coco's `manager.auth` name is easy to misread: in `v1.0.1` it implements Cashu
mint authentication (NUT-21/22 and OIDC/CAT/BAT session persistence), not Nostr
or npub.cash authentication. NIP-07, entered `nsec`, NIP-46, signer selection,
and npub.cash NIP-98/JWT authentication belong above Coco. [Coco Auth API source](https://github.com/cashubtc/coco/blob/v1.0.1/packages/core/api/AuthApi.ts),
[local npub.cash auth provider](../sdk/src/provider.ts)

The local SDK already has the right lower-level boundary: `SigningFunc` signs an
event template, and `JWTAuthProvider` caches only a roughly five-minute JWT in
memory. It does not persist or reconnect the underlying signer. Signer
persistence therefore belongs to a dedicated Claim Companion auth/session
module, not a React context and not Coco.

NIP-46 imposes requirements that module must model explicitly:

- Keep three identities distinct: the local disposable **client keypair**, the
  **remote-signer pubkey**, and the actual **user pubkey**. After connection the
  client must call `get_public_key`; it must not assume the signer transport key
  is the user's identity.
- Persist enough local session material to reconnect an authorized client:
  client keypair, remote-signer pubkey, current relay set, user pubkey, and
  granted/requested permissions. Delete the client keypair on local logout.
- Validate the required connection secret returned by a `nostrconnect://` flow.
  A `bunker://` optional secret is single-use and must not be treated as a
  reusable password.
- Support both `nostrconnect://` and `bunker://` initiation, `ping`,
  `switch_relays`, reconnect/resubscribe after transport loss, explicit local
  logout, and the remote `logout` courtesy request.
- Handle `auth_url` responses by opening the URL and continuing to listen for a
  second response with the **same request ID**; an auth popup is not a terminal
  failure.

These requirements come directly from the current [NIP-46 specification](https://github.com/nostr-protocol/nips/blob/master/46.md).
They explain why storing a loosely typed bunker pointer and testing only `ping`
is not a complete session model.

## Immediate architectural constraints

1. Pin one coherent Coco release line. Do not combine stable `@cashu/*` packages
   with the old `coco-cashu-*` NPC plugin.
2. Port the NPC plugin contract to stable Coco before treating it as a dependency:
   persistent sync watermark, idempotent quote import, websocket invalidation,
   safe retry, and an extension API for account/quote actions.
3. Put wallet seed storage, signer storage, and Coco IndexedDB in separate,
   versioned stores keyed by user/account identity, with an explicit rule for
   what logout deletes versus merely locks.
4. Treat IndexedDB operation recovery as the normal restart path and BIP-39/
   NUT-09 restore as disaster recovery. Neither replaces the other.
5. Ship ecash and BOLT11 first. Keep on-chain in the domain model but behind
   runtime capability checks until both Coco and the selected mint support it.
