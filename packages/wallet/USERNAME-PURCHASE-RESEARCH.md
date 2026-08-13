# Username purchase research

Research date: 2026-08-12

Selected client tuple:

- `@cashu/coco-core@2.0.0-rc.1` (source commit
  [`e635155a`](https://github.com/cashubtc/coco/commit/e635155a5f23f418350e6839f84cbfd37366efb6))
- `coco-cashu-plugin-npc@3.0.0-rc.20260707.3.1.sha.debd5dd`
  (source commit
  [`debd5ddf`](https://github.com/Egge21M/coco-cashu-plugin-npc/commit/debd5ddf6213cdc56a464e8d05c53ad57e6c527b))
- current npub.cash server/SDK source commit
  [`d525051f`](https://github.com/cashubtc/npubcash-server/commit/d525051f510bca313a8941e3da6d9a4c66075205)

## Verdict

The pinned NPC nightly and Coco RC1 contain a working happy-path bridge for a
paid username. `NPCAccountApi.setUsername(username, true)` obtains the 402
Payment Request, asks Coco to construct an in-band ecash token from local
proofs, encodes that token, and retries the authenticated username request with
the token in `X-Cashu`.

The important release blocker is not protocol compatibility; it is
end-to-end recovery. Coco persists a crash-aware send operation, but the NPC
plugin does not persist the relationship between that operation/token and the
username purchase. The server also redeems the token before committing the
username and has no purchase ID or idempotency record. A lost response or a
failure in either gap can leave a paid-but-unconfirmed username purchase.

**Recommendation:** include username purchasing only after adding a small,
durable wallet-side purchase saga and server-side idempotency/atomicity. Until
then, hide or mark the paid purchase UI experimental. Never respond to an
ambiguous retry by preparing a second token.

## Exact server and SDK flow

`POST /api/v2/user/username` is Nostr-authenticated and receives
`{"username":"alice"}`. The route binds the authentication method to the exact
URL and `POST` method. [Server route](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/routes/v2/userRoutes.ts#L17-L22)

For a positive configured cost, a first request without `X-Cashu` returns HTTP
402. The middleware exposes the `X-Cashu` header to browser JavaScript and puts
this CBOR object in a `creqA` envelope:

```json
{ "a": "configured integer amount", "u": "sat", "m": ["configured mint URL"] }
```

There is no request ID, `singleUse` flag, description, or transport. An absent
transport means that the enclosing protocol carries the payment in-band; that
is exactly the NUT-18 rule for an `X-Cashu` flow. [402 construction](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/errors/middleware.ts#L45-L75),
[NUT-18 transport rule](https://github.com/cashubtc/nuts/blob/main/18.md#transport)

The SDK parses the header with its `PaymentRequest.fromEncodedRequest()` and
throws `PaymentRequiredError`. On the paid attempt,
`setUsername(username, tokenString)` sends the encoded Cashu token in
`X-Cashu`; it does not put the token in the JSON body. [SDK 402 parsing](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/sdk/src/client.ts#L222-L253),
[SDK paid retry](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/sdk/src/client.ts#L88-L114)

On receipt, the server:

1. decodes the Cashu token;
2. requires `token.mint === USERNAME_MINT` by exact string comparison;
3. accepts a proof sum greater than or equal to the configured price;
4. redeems/swaps the token and saves the received proofs;
5. only then writes the username and returns HTTP 201.

[Username controller and payment validation](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/controller/username.ts#L16-L91)

If the configured amount is zero, the endpoint skips the Cashu flow entirely.
The cost must be a non-negative safe integer and the feature is disabled unless
both `USERNAME_COST` and `USERNAME_MINT` are present. [Environment parsing](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/config/env.ts#L142-L158)

## Payment Request field mapping

In the Cashu version used by Coco RC1, `PaymentRequest` represents:

| Wire field | cashu-ts property | npub.cash value |
| --- | --- | --- |
| `i` | `id` | omitted |
| `a` | `amount` | fixed username price |
| `u` | `unit` | `sat` |
| `s` | `singleUse` | omitted/false |
| `m` | `mints` | one strict configured mint |
| `d` | `description` | omitted |
| `t` | `transport` | omitted, therefore in-band |
| `nut10` | `nut10` | omitted |

cashu-ts 4.5.x can encode/decode both `creqA` (CBOR) and experimental `creqB`,
but npub.cash emits `creqA`. Its payment payload model has `id?`, `memo?`,
`unit`, `mint`, and `proofs`. [cashu-ts PaymentRequest model](https://github.com/cashubtc/cashu-ts/blob/v4.5.0/src/model/PaymentRequest.ts),
[cashu-ts request/payload types](https://github.com/cashubtc/cashu-ts/blob/v4.5.0/src/wallet/types/payment-requests.ts),
[NUT-18 request and payload](https://github.com/cashubtc/nuts/blob/main/18.md#payment-request)

The SDK depends on cashu-ts 3.x while Coco RC1 uses cashu-ts 4.5.x. This does
not require sharing a class instance: the nightly deliberately re-encodes the
SDK object to a `creqA` string and passes that string across the version
boundary. The final token is likewise a standardized encoded string. Keep
these serialized boundaries; do not cast an SDK `PaymentRequest` into Coco's
type. [SDK dependency](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/sdk/package.json#L20-L24),
[Coco dependency](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/package.json#L54-L61)

## What Coco RC1 does

The relevant public API is:

```ts
const request = await manager.paymentRequests.parse(encodedRequest)
const prepared = await manager.paymentRequests.prepare(request, { mintUrl })
const result = await manager.paymentRequests.execute(prepared)
```

For this request, `parse` produces an in-band request and computes
`payableMints`. A mint is listed only when it is trusted, has `sat` spendable
balance at least equal to the requested amount, and its stored URL occurs in
the request's mint list. `prepare` requires the selected URL to be in the mint
list, requires any caller-supplied amount/unit to match, initializes a normal
send, and reserves suitable proofs. `execute` returns a raw `Token` plus a
persisted `PendingSendOperation`; it does not return an encoded token string.
[Coco API](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/api/PaymentRequestsApi.ts#L87-L118),
[parse/prepare constraints](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/services/PaymentRequestService.ts#L99-L131),
[mint and transport resolution](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/services/PaymentRequestService.ts#L204-L265),
[in-band execution](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/services/PaymentRequestService.ts#L139-L153)

`payableMints` is advisory UX, not a promise that preparation will succeed. Its
balance test compares spendable value with the face amount, while a swap may
also require input fees. The send preparation performs the authoritative proof
selection and fee check. [Default send preparation](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/infra/handlers/send/DefaultSendHandler.ts#L20-L105)

## What the pinned NPC nightly adds

The plugin already implements the application bridge in
`NPCAccountApi.setUsername`:

1. call the SDK without a token;
2. catch `PaymentRequiredError` and re-encode its request;
3. parse it with Coco;
4. select `payableMints[0]` (or return `{success:false, pr}` when none exists);
5. force in-band transport, prepare, and execute;
6. encode `result.token` with `getEncodedToken`;
7. retry the same username through the SDK with that encoded token;
8. return success only after the retry succeeds.

[Nightly implementation](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/PluginApi.ts#L85-L126),
[nightly flow test](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/tests/PluginApi.test.ts#L37-L100)

The server request is already in-band, so the forced transport does not alter
today's response. It makes the plugin robust against an erroneous or future
HTTP transport because the username token must be carried by the authenticated
retry's `X-Cashu` header.

## Compatibility and policy constraints

- **Mint:** the wallet must hold enough ready proofs at the one mint named by
  the server, and that mint must be trusted in Coco. There is no cross-mint
  payment or automatic Lightning swap in this flow.
- **URL identity:** both Coco's allowed-mint matching and the server's paid-token
  validation use exact strings. Coco normalizes mint URLs when storing them,
  but the Payment Request service does not normalize the request's `m` values
  before comparison. Configure `USERNAME_MINT` in Coco's canonical form
  (lowercase host, default port removed, no trailing slash) and test equality
  end to end. [Coco URL normalization](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/utils.ts#L285-L314),
  [exact allowed-mint comparisons](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/services/PaymentRequestService.ts#L213-L265)
- **Amount:** the request is fixed-price. Coco constructs the face amount;
  send/swap input fees may additionally reduce the wallet balance. The server
  accepts overpayment, but the normal Coco path does not intentionally tip.
- **NUT-18 input-fee semantics:** the current NUT defines `a` as the amount net
  of the receiver's input fees, but the server validates only the gross sum of
  incoming proofs. Coco's default send constructs send proofs at the face
  amount; its preparation accounts for a sender-side swap fee when a swap is
  needed, not an extra receiver-input-fee amount. The present server therefore
  accepts the pinned tuple but absorbs the receive fee. If npub.cash changes to
  NUT-18 net-amount validation, this path needs a fee-aware compatibility
  update. [NUT-18 input fees](https://github.com/cashubtc/nuts/blob/main/18.md#input-fees),
  [Coco default send amounts](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/infra/handlers/send/DefaultSendHandler.ts#L20-L105)
- **Unit:** only `sat` works for the current server response. Other-unit proofs
  and aggregate total balance do not make a mint payable.
- **Transport:** omitted means in-band. The app must submit the encoded token in
  the authenticated retry; Coco must not post it to an unrelated callback.
- **Token shape:** after Coco execution, call `getEncodedToken(result.token)`.
  Do not send the raw token JSON and do not send the NUT-18
  `PaymentRequestPayload` object to this endpoint.

## State after payment and before the retry

Immediately after in-band `execute`, the wallet's send operation is `pending`
and its send proofs are `inflight`. This is intentional: the receiver has not
spent them yet. The next action is to persist the encoded token and submission
state, then call `setUsername(username, sameTokenString)`. There is no need to
wait for or manually finalize the send before submitting it.

After the server redeems the token, Coco's proof-state watcher/recovery can see
that the send proofs are spent and finalize the operation. Coco's send saga is
`init -> prepared -> executing -> pending -> finalized/rolled_back`, and
`finalize(operationId)` itself is idempotent. [Send operation state model](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/operations/send/SendOperation.ts#L1-L25),
[token and pending state](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/infra/handlers/send/DefaultSendHandler.ts#L130-L217),
[idempotent finalization](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/operations/send/SendOperationService.ts#L346-L451)

## Retry and idempotency gaps

The Payment Request has no `i` ID and is not marked single-use. Coco does not
deduplicate Payment Requests: every `prepare` initializes a new random send
operation. Re-running the NPC helper after an ambiguous failure therefore
starts a new payment instead of recovering the old one. [Coco prepare path](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/services/PaymentRequestService.ts#L118-L131),
[send initialization](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/operations/send/SendOperationService.ts#L126-L170)

The current plugin keeps the encoded token only on the JavaScript stack. A
crash after `execute` but before/during the SDK retry leaves Coco's pending send
operation durable, but no durable app record saying which token purchases
which username or that it should be resubmitted. This is an inference from the
plugin flow and Coco's persisted pending operation. The public helper returns
only `{success:true}` after the entire flow (or the unpaid request when there is
no payable mint), so the wallet cannot safely add persistence around its
internal execute/submit boundary. The controlled NPC package needs a staged or
callback-based purchase API, or it must own the durable saga itself.

There are also two server-side ambiguity windows:

- it redeems and saves the token before writing the username, so a later
  username-write failure can consume the payment without granting the name;
- it validates to a lowercased/trimmed `parsedUsername`, but checks availability
  with the original request string. A case/whitespace variant can therefore
  pass the preflight check, be paid, and only then fail the database's unique
  constraint for the normalized name;
- if the server commits the username but the 201 response is lost, a fresh
  request can report that the username is taken. The preflight availability
  check is not ownership-aware, and username uniqueness is enforced in the
  database.

[Server ordering](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/controller/username.ts#L34-L58),
[username existence check](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/domain/user/UserService.ts#L62-L76),
[unique schema](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/migrations.ts#L91-L105)

## Required wallet contract

Before exposing paid purchases as a normal release feature, persist a purchase
record in the pubkey-keyed wallet database:

```ts
type UsernamePurchase = {
  username: string
  request: string          // exact creqA or a stable fingerprint
  amount: string
  unit: "sat"
  mintUrl: string
  operationId?: string
  encodedToken?: string    // persist immediately after execute
  state: "quoted" | "prepared" | "token-created" | "submitting" |
         "confirmed" | "ambiguous" | "failed"
}
```

Recovery rules:

1. Serialize purchase attempts per account/username.
2. Persist the intent before preparing; persist `operationId` when known.
3. Persist the exact encoded token before the paid HTTP request.
4. On network error, timeout, or reload, query account info first. If this
   pubkey already owns the requested username, mark confirmed.
5. Otherwise resubmit **the same token**. Never call prepare/execute again while
   a prior token is pending or its outcome is ambiguous.
6. If the same token is reported spent but the account does not own the name,
   stop and show a support/reconciliation state; do not silently charge again.
7. If the server definitively rejected the request before redemption (for
   example, a username race), reclaim the recorded pending send with
   `manager.ops.send.reclaim(operationId)` instead of abandoning inflight
   proofs.
   [Coco send recovery API](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/api/SendOpsApi.ts#L101-L165)
8. Keep enough operation/token data to let Coco's normal proof watcher finalize
   the send after server redemption.

The stronger fix belongs on the server: emit a stable purchase ID in `i`, bind
it to pubkey + normalized username + price + mint, record token redemption and
username assignment as one idempotent purchase state machine, and make a replay
return the original success. A database transaction alone cannot make the
external mint redemption atomic, so explicit reconciliation state is still
needed.

## Frontend surface without changing the NPC nightly

The current public API supports a coarse review/confirm UI, not a staged
payment UI:

| UI stage | Public call/result | Important limitation |
| --- | --- | --- |
| Request/review | `account.setUsername(name, false)` (or omit the second argument) | For a paid name, returns `{success:false, pr}`. The SDK cashu-ts 3.x object exposes numeric `amount`, `unit`, `mints`, and the other Payment Request fields, so the UI can show the quoted price and required mint. It does not include Coco's `payableMints` or a balance verdict. It is a class instance rather than a plain DTO; extract scalar display fields or retain `toEncodedRequest()` instead of blindly JSON-serializing it. |
| Free claim | Same call returns `{success:true}` | This is not a read-only quote endpoint. If the server currently charges zero, the first call assigns the username immediately. Label the action accordingly. |
| Confirm/pay | `account.setUsername(name, true)` | One opaque promise covers a new server request, Coco parse/prepare/execute, token encoding, and the paid server retry. The UI can show only a general “Purchasing…” state. |
| No payable mint | Resolves `{success:false, pr}` | This is based on the newly fetched request. No send is prepared or executed. |
| Success | Resolves `{success:true}` | This means the final server call succeeded, but no user record, send operation, or receipt is returned. |
| Other failure | Promise rejects | Non-402 server, authentication, network, Coco prepare/execute, and final-submission errors are not wrapped with a username-purchase stage or recovery data. |

[NPC public implementation](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/PluginApi.ts#L78-L127),
[result type](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/types.ts#L36-L49),
[SDK Payment Request fields](https://github.com/cashubtc/cashu-ts/blob/v3.2.2/src/model/PaymentRequest.ts)

The confirm call **does not reuse the reviewed Payment Request**. Every
invocation first calls `runtime.client.setUsername(username)` without a token.
With `true`, it catches that call's new 402 and pays the newly returned request.
The reviewed request is neither passed back nor compared by ID, amount, unit,
or mint. Calling review immediately before confirm narrows the race but does
not remove it. A server price/mint change between calls can therefore cause the
helper to pay terms the user did not see. Without a plugin change, the UI must
treat the displayed quote as provisional and cannot provide strong exact-term
payment consent. [NPC call sequence](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/PluginApi.ts#L88-L120)

The helper exposes no prepared/pending operation, operation ID, encoded token,
submission state, progress callback, or structured stage error. Its
`getStatus()` reports account runtime readiness, syncing, WebSocket, and
shutdown state only. Coco can list all in-flight sends independently, but they
carry no username/request association, so the frontend must not infer or
automatically reclaim “the newest matching send.” [NPC account status](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/types.ts#L131-L145),
[Coco in-flight send API](https://github.com/cashubtc/coco/blob/e635155a5f23f418350e6839f84cbfd37366efb6/packages/core/api/SendOpsApi.ts#L101-L165)

### Safest ambiguous-error UX with the existing APIs

After any network/timeout/unknown rejection from `setUsername(name, true)`, do
not show “failed” and do not offer a button that calls `true` again. The plugin
does not reveal whether the error occurred before token creation, while sending
the paid request, or after the server committed it.

Show **“Purchase status unknown — checking your account”** and repeatedly call
the read-only `account.getInfo()` with bounded backoff:

- if `info.name === requestedName`, mark the purchase successful;
- if account lookup is unavailable, retain the unknown state and offer only
  “Check again” plus support/diagnostic guidance;
- if the account returns a different/no name, still do not conclude that
  payment is safe to repeat: the server can redeem before its username write;
- surface any general Coco in-flight send in wallet activity as pending, but do
  not claim it is this purchase or automatically reclaim it;
- never auto-retry `setUsername(..., true)` on reload, reconnect, repeat click,
  or account-info mismatch.

`getInfo()` returns the authenticated user including optional `name`, which is
the only public post-error ownership check the plugin provides. This polling
can confirm success but cannot prove non-payment. A safely retryable or
reclaimable failure requires the staged plugin API described above (or
server-side idempotency). [NPC `getInfo`](https://github.com/Egge21M/coco-cashu-plugin-npc/blob/debd5ddf6213cdc56a464e8d05c53ad57e6c527b/src/PluginApi.ts#L78-L84),
[SDK user result](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/types/src/user.ts#L1-L12),
[server redeem-before-write order](https://github.com/cashubtc/npubcash-server/blob/d525051f510bca313a8941e3da6d9a4c66075205/packages/server/src/controller/username.ts#L38-L58)

## Release tests

- paid happy path from exact proofs and from a swap-requiring balance;
- insufficient face balance and sufficient face balance but insufficient fee
  headroom;
- untrusted/missing configured mint and non-`sat` balances;
- `USERNAME_MINT` URL variants (case, default port, trailing slash);
- reload after prepare, after token creation, during submission, and after
  server redemption before the 201 reaches the browser;
- repeat-click/concurrent purchase suppression;
- same-token resubmission and server replay after success;
- username race between 402 issuance and paid retry;
- case/whitespace variants of an already-taken normalized username;
- server failure after redeem/save but before username write.
