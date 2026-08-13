# Locked npub.cash quote / NUT-20 research

Verified on **2026-08-12** against `@cashu/coco-core@2.0.0-rc.1`,
`coco-cashu-plugin-npc@3.0.0-rc.20260707.3.1.sha.debd5dd`, the npub.cash
server and SDK in this repository, current NUT-20, NIP-01, NIP-07, and NIP-46.
The published artifacts resolve to Coco commit
[`e635155a`](https://github.com/cashubtc/coco/commit/e635155a5f23f418350e6839f84cbfd37366efb6)
and NPC commit
[`debd5ddf`](https://github.com/Egge21M/coco-cashu-plugin-npc/commit/debd5ddf6213cdc56a464e8d05c53ad57e6c527b).

## Verdict

**The selected tuple does not correctly claim npub.cash quotes marked
`locked`. Quote locking should not be offered in the first wallet release.**

An unlocked paid quote follows the expected NPC import -> Coco prepare -> Coco
execute path. A locked quote follows exactly the same path and reaches the mint
without a NUT-20 signature. A conforming mint must reject that request. There
are also three deeper compatibility problems: npub.cash does not return the
quote's locking public key, its server supplies a 32-byte Nostr public key where
current NUT-20 requires a 33-byte compressed key, and the Cashu library selected
by Coco RC1 implements the pre-June-2026 NUT-20 signature message.

This is not solved by passing the wallet's existing Nostr `signer` to the NPC
plugin. That signer signs Nostr events for API authentication; NUT-20 requires a
different signature over the exact Cashu mint request.

## End-to-end trace

1. When quote locking is enabled, npub.cash calls
   `getLockedMintQuote(amount, userData.pubkey)`. `userData.pubkey` is the
   Recipient's Nostr public key, passed through unchanged, and the server stores
   `locked: true`. [npub.cash quote creation](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/domain/communicator/CommunicatorService.ts#L18-L31)
2. The authenticated wallet API returns `locked`, but **not** the quote's
   NUT-20 `pubkey`. [server response mapping](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/controller/wallet.ts#L78-L92),
   [public quote type](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/types/src/wallet.ts#L3-L14)
3. The NPC nightly spreads all server fields into a paid BOLT11 quote, imports
   it, prepares a normal Coco mint operation, and executes it. It has no branch
   for `locked`, no NUT-20 signer service, and no locked-quote test. Its
   `Signer` type is only the npub.cash SDK's JWT/NIP-98 event signer.
   [NPC import/execute path](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts#L536-L609),
   [NPC signer type](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/types.ts#L36-L41),
   [sync fixtures](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/tests/helpers.ts#L184-L212)
4. Coco RC1 preserves an imported BOLT11 quote's optional `pubkey` on the
   operation, but its BOLT11 executor calls `mintProofsBolt11(..., undefined,
   outputs)`: the `undefined` is the signing configuration. The recovery path
   repeats the same unsigned call. [Coco BOLT11 mint handler](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/infra/handlers/mint/MintBolt11Handler.ts#L75-L108)
5. Coco's NUT-20 support is currently internal and method-specific, not a
   general external-signer bridge. Its on-chain and BOLT12 handlers derive a
   NUT-20 key from the Coco seed, persist it under the
   `nut20_mint_quote` purpose, and pass the corresponding private key to
   cashu-ts. The BOLT11 handler does none of that. The public keyring API can
   add only ordinary `p2pk` keys, not an external NUT-20 key.
   [Coco key derivation and purposes](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/services/KeyRingService.ts#L11-L87),
   [on-chain signing contrast](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/infra/handlers/mint/MintOnchainHandler.ts#L98-L120),
   [public keyring API](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/api/KeyRingApi.ts)

The practical result is an unsigned `POST /v1/mint/bolt11`. Current NUT-20 says
a mint quote carrying a public key may be redeemed only with a valid BIP340
signature and mandates error `20008` when it is absent or invalid.
[NUT-20 mint request](https://github.com/cashubtc/nuts/blob/e6e953658cbf62704e1618960eb5cc010864840c/20.md#minting-tokens),
[NUT-20 errors](https://github.com/cashubtc/nuts/blob/e6e953658cbf62704e1618960eb5cc010864840c/20.md#errors)

### Failure state under the pinned tuple

The failed attempt is not harmlessly ignored. Coco has already persisted the
mint operation and its deterministic outputs. Its executor changes the
operation to `executing`; after the mint rejects the unsigned request, recovery
checks the still-`PAID` quote and makes the same unsigned request again, then
returns the operation to `pending`. [Coco execution and recovery transition](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/operations/mint/MintOperationService.ts#L363-L440),
[BOLT11 recovery call](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/infra/handlers/mint/MintBolt11Handler.ts#L111-L166)

Coco's processor does not retry a protocol `MintOperationError` such as
`20008`, although an already-queued pending event can cause another execution
attempt. On the next NPC synchronization, any existing operation whose state is
not `init` is classified as “already tracked” and skipped; the plugin can then
advance its paid-at watermark. The durable Coco operation remains pending, but
NPC sync no longer presents the quote as a fresh failure. UI and diagnostics
must therefore treat Coco operation state—not a successful `account.sync()` or
the NPC watermark—as authoritative. [processor error policy](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/services/watchers/MintOperationProcessor.ts#L437-L487),
[NPC existing-operation skip](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/accounts/NPCAccountRuntime.ts#L548-L570)

## Public-key and protocol-version mismatches

### Nostr key encoding

NIP-01 event public keys are 32-byte x-only values. Current NUT-20 quote public
keys are 33-byte compressed secp256k1 values. npub.cash passes the former into
the latter field without conversion. [NIP-01 event format](https://github.com/nostr-protocol/nips/blob/master/01.md#events-and-signatures),
[NUT-20 key requirement](https://github.com/cashubtc/nuts/blob/e6e953658cbf62704e1618960eb5cc010864840c/20.md#mint-quote)

cashu-ts 4.5.1's own verifier also rejects every public key that is not exactly
33 bytes. Therefore the present server request is not conforming even before
wallet redemption is considered. A mint may accept the x-only form as a legacy
extension, but the wallet design must not assume that behavior.
[cashu-ts 4.5.1 NUT-20 implementation](https://github.com/cashubtc/cashu-ts/blob/v4.5.1/src/crypto/NUT20.ts#L27-L38)

Using the Recipient's long-lived Nostr key for every quote also conflicts with
NUT-20's privacy recommendation to use a unique quote-locking key for every
quote. It reveals a stable, public identity to the mint and links all protected
quotes. [NUT-20 privacy and derivation guidance](https://github.com/cashubtc/nuts/blob/e6e953658cbf62704e1618960eb5cc010864840c/20.md#deterministic-quote-locking-key-derivation)

### Signature message version

Coco RC1 depends on `@cashu/cashu-ts: "4.5"` (currently resolving to 4.5.1).
cashu-ts 4.5.1 signs the legacy message
`SHA256(quote || B_0 || ... || B_n)`; it does not commit output amounts and has
no domain separator. [Coco RC1 manifest](https://github.com/cashubtc/coco/blob/v2.0.0-rc.1/packages/core/package.json),
[cashu-ts legacy construction](https://github.com/cashubtc/cashu-ts/blob/v4.5.1/src/crypto/NUT20.ts#L7-L24)

NUT-20 changed incompatibly on 2026-06-07. It now signs the SHA-256 hash of a
domain-separated, length-framed message that commits the quote ID, every output
amount, and every blinded point. The specification change explicitly says mints
no longer accept the legacy message. [breaking NUT-20 commit](https://github.com/cashubtc/nuts/commit/b969c4aa3fda246872e80d8cf74ca080240cd914),
[current message construction](https://github.com/cashubtc/nuts/blob/e6e953658cbf62704e1618960eb5cc010864840c/20.md#message-aggregation)

Consequently, simply teaching Coco RC1's BOLT11 handler to pass a private key to
its existing cashu-ts dependency would still not produce a current NUT-20
signature.

## How the Recipient's Nostr signer can participate

The NPC signer participates today only in NIP-98 authentication: it signs a
Nostr event, obtains a short-lived JWT, and signs WebSocket authentication
events. It never sees the blinded Cashu outputs.
[npub.cash JWT auth provider](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/sdk/src/provider.ts#L7-L29)

| Sign-in mode | Can produce a standard NUT-20 signature? | Prompt behavior |
| --- | --- | --- |
| Direct `nsec` | **Potentially**, because the app has the private key after passphrase unlock. The current NPC/Coco interfaces still do not request or carry that signature. | No extra user prompt is technically required after session unlock. |
| NIP-07 | **No standard method.** NIP-07 exposes `getPublicKey`, `signEvent`, and optional NIP-04/44 encryption. `signEvent` signs a serialized Nostr event hash, not the NUT-20 mint message. | A future non-standard raw-sign extension might prompt once per claim, but cannot be assumed or requested through NIP-07 today. |
| NIP-46 `nostrconnect://` | **No standard method.** NIP-46 defines `sign_event`, encryption/decryption, connection, relay, and session commands. Unknown methods must return an error. | A custom command would require coordinated wallet and bunker support plus a new permission model; it is not portable NIP-46. |

[NIP-07 methods](https://github.com/nostr-protocol/nips/blob/master/07.md),
[NIP-46 commands and unknown-method rule](https://github.com/nostr-protocol/nips/blob/master/46.md#methodscommands)

NUT-20 does **not** require one authorization per proof. One signature commits
to the quote and the entire ordered output array. A correct signer bridge should
therefore make one `signMintQuote` request per claim attempt, after deterministic
outputs have been durably prepared. It must reuse those exact outputs on retry;
regenerating outputs requires a new signature. Any design that prompts once per
output is an implementation mistake, not a protocol requirement.

## First-release recommendation

1. Do not expose the npub.cash **Lock quotes** setting in the first wallet.
   Default it to off for new users.
2. When sync sees `locked: true`, do not repeatedly execute an unsigned Coco
   operation. Persist/display an explicit **Protected payment unsupported**
   state and leave the quote unissued at the mint.
3. Treat already-paid locked quotes as a separate rescue/migration problem.
   Direct-`nsec` rescue may be implementable after the server key encoding and
   NUT-20 message version are corrected; standard NIP-07 and NIP-46 cannot
   rescue them today.
4. Do not claim first-release locked-quote support until a real-mint integration
   test passes for every advertised signer mode. A paid quote that cannot be
   claimed is worse than an unlocked quote in this claim-companion product.

## What must change before enabling quote locking

A durable design needs coordinated changes across the packages npub.cash
controls:

- Upgrade the Cashu dependency and Coco BOLT11 handler to the hardened current
  NUT-20 message, then pin the compatible tuple.
- Stop using the stable Nostr identity key directly as the quote key. Prefer a
  unique Coco-seed-derived NUT-20 key per quote. Because npub.cash creates the
  quote before the browser claims it, this requires a server protocol for
  registering/allocating wallet-generated quote-locking public keys (or an
  equivalent pre-published key pool).
- Return the exact quote `pubkey` (and a version/key reference if needed) in the
  npub.cash quote API. A boolean `locked` flag is insufficient to select and
  verify a signing key.
- Add an explicit locked-quote path to the NPC plugin and a narrow async
  `signMintQuote({ quoteId, outputs, pubkey })` capability to Coco's BOLT11 mint
  operation. The output set and resulting signature must be persisted for
  crash-safe replay.
- Define behavior for loss/rotation of the wallet seed and for outstanding
  quotes whose registered locking key belongs to an old wallet installation.
- Add end-to-end tests for paid locked quote import, correct key selection,
  hardened signature bytes, crash/retry with identical outputs, wrong-key
  rejection, and signer cancellation/unavailability.

If support for all three sign-in modes remains a product requirement, the
wallet-seed-derived key design is the viable direction: it keeps NUT-20 signing
inside Coco and uses the Nostr signer only to authenticate account/key
registration. Making the Recipient's Nostr signer sign arbitrary Cashu messages
would require non-standard extensions to both NIP-07 and NIP-46 ecosystems.
