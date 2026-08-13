# npub.cash Wallet Implementation Map

Status: proposed implementation map

This map turns the accepted [`DESIGN.md`](./DESIGN.md) into end-to-end vertical
slices. Each numbered slice delivers a behavior that can be exercised through
the browser, crosses every layer needed for that behavior, and leaves the main
branch in a releasable state for the capabilities completed so far.

The slices are ordered by risk and dependency, not by screen. Infrastructure,
persistence, protocol integration, UI states, and tests are completed together
when a user outcome first needs them. A slice is not complete when only its UI,
state store, or Coco integration exists.

## Slice Contract

Every product slice must include:

- A browser-demonstrable Recipient outcome using production-shaped boundaries
- Loading, empty, success, failure, and recovery states that are relevant to
  that outcome
- The smallest route, application, signer, Coco, API, and persistence changes
  needed to support it end to end
- IndexedDB schema/version handling when persisted data changes
- Accessible keyboard behavior, focus handling, live status, and non-color
  status cues
- Unit tests for new deterministic policy, integration tests across the new
  boundary, and browser coverage for its critical happy and recovery paths
- No deliberate logging of passphrases, nsecs, Recovery Phrases, proofs, or
  encoded ecash tokens
- Current shadcn project inspection and component documentation review before
  UI implementation; only accepted components from the official `@shadcn`
  registry

Tests may use deterministic signers, APIs, mints, and Coco repositories, but
the browser demonstration must use the same application path as production.
Feature flags may hide an incomplete capability; they may not substitute a
second implementation.

## Dependency Map

```text
Runway
  └─ 1. NIP-07 opens a durable Wallet
      ├─ 2. Direct nsec survives a reload safely
      ├─ 3. Remote signer pairs and reconnects
      └─ 4. A paid npub.cash quote becomes balance
          ├─ 5. Claim problems can be understood and recovered
          └─ 6. Ecash can be sent, reopened, and reclaimed
              ├─ 7. A Lightning invoice can be paid and reconciled
              ├─ 8. Wallet and npub.cash settings are manageable
              └─ 9. A Recipient Username can be purchased safely

All completed slices
  └─ 10. Release candidate proven at wallet.npub.cash
```

Slices 2 and 3 can proceed independently once Slice 1 establishes the signer
adapter contract. Slice 5 can proceed beside Slice 6 after Slice 4 establishes
the persisted claim and Activity projection. Slices 7, 8, and 9 can proceed in
parallel after Slice 6 proves the shared operation-confirmation and resumption
patterns. Parallel work must still integrate in numbered dependency order.

## Runway: Reproducible Wallet Build

This is a tightly bounded enabling step, not a product slice. It exists because
the initialized package cannot support reliable vertical work in its current
toolchain shape.

Deliver:

- Make `packages/wallet` an ordinary package in the parent repository; remove
  the accidental nested repository metadata intentionally while retaining all
  wallet files.
- Align the wallet on TypeScript 5.9.3 and a Vite/plugin/ESLint tuple compatible
  with the parent workspace.
- Pin the complete Coco/NPC tuple from ADR 0001 with exact versions and commit
  the lockfile.
- Add separate `typecheck`, `lint`, `test`, browser-test, and production-build
  commands that work from the repository root.
- Establish environment validation for the npub.cash API origin and allowed
  NIP-46 relay configuration. Secrets and sensitive wallet values are never
  build-time environment variables.
- Add a minimal CI job using a frozen lockfile.

Exit proof:

- A clean checkout installs reproducibly and passes typecheck, lint, one unit
  smoke test, and a production build.
- The Vite application starts from the root workspace without package export
  or peer dependency errors.
- No product screen beyond the initialized shell is designed in this step.

## Slice 1: NIP-07 Opens a Durable Wallet

**Recipient outcome:** A Recipient with a NIP-07 extension can sign in, create
or reopen the Wallet Installation for that Public Key, see an empty real Coco
wallet, reveal the generated Recovery Phrase, and Sign Out without deleting
wallet data.

End-to-end path:

1. `/` detects NIP-07 and offers it as the primary sign-in action.
2. The NIP-07 adapter obtains and normalizes the Public Key, persists only that
   expected key, and reacquires it from the extension on every open.
3. The wallet registry serializes first creation, generates a 12-word BIP-39
   phrase with `@scure/bip39`, derives Coco's seed, and records it by Public Key.
4. `WalletRuntimeProvider` opens the Public-Key-named IndexedDB database,
   creates the pinned Coco Manager once, and provides Coco React state.
5. `/wallet` renders the real zero balance and empty claim state.
6. `/settings/recovery` reveals the phrase only after confirmation and clearly
   says this release cannot restore it.
7. Sign Out tears down Coco, closes Dexie, removes the NIP-07 signer record, and
   returns to `/` while retaining wallet seed and proof data.

UI composition:

- App shell and repo-native responsive navigation composed from shadcn ghost
  `Button`s and Lucide icons
- Sign-in `Card`, signer `Button`, browser-data-loss `Alert`
- Initialization step list with `Spinner` and live status
- Balance composition, `Skeleton`, and `Collapsible` mint breakdown
- Recovery risk `Alert` and titled confirmation `Dialog`
- Settings `Item` rows and `Separator`s

Required failure behavior:

- Extension missing, rejected, or reporting a different Public Key
- Existing wallet database with missing seed refuses to open and offers Sign
  Out plus a separately confirmed destructive local-removal path
- Existing seed with missing database recreates an empty database from the same
  seed and warns that local proofs and Activity are absent
- Another Public Key opens a distinct database and never observes the first
  wallet's state
- Private browsing receives a storage-durability warning

Exit proof:

- Browser tests cover first open, reload, Sign Out/reopen, Public Key mismatch,
  identity switching, seed/database inconsistency, and Manager/Dexie teardown.
- IndexedDB inspection confirms Public-Key separation and stable seed reuse.
- No mock balance or parallel application wallet store exists.

## Slice 2: Direct nsec Survives a Reload Safely

**Recipient outcome:** A Recipient can enter an nsec, protect it with a
passphrase, unlock it after every reload, and re-enter the same nsec if the
passphrase is forgotten without losing the existing Wallet Installation.

End-to-end path:

1. **Use an nsec** expands the advanced sign-in path.
2. The form validates the nsec, passphrase minimum, and confirmation.
3. A versioned signer vault encrypts the nsec with WebCrypto PBKDF2 and AES-GCM
   using a unique salt and calibrated parameters.
4. The derived Public Key enters the same registry/runtime path proven in
   Slice 1.
5. A reload presents passphrase unlock before the wallet opens.
6. **Forgot passphrase** deletes only the encrypted signer record. Entering the
   same nsec and a new passphrase reopens the same Public-Key-selected wallet.

UI composition:

- Advanced disclosure using `Collapsible`
- Security `Alert`
- `FieldGroup`, `Field`, `Input`, `FieldError`, and submit `Button` with
  `Spinner`
- Titled `AlertDialog` for forgetting the encrypted signer record

Required failure behavior:

- Invalid nsec, incorrect passphrase, corrupt or unsupported vault envelope,
  interrupted encryption write, and vault migration failure
- Decrypted key material and decryption keys exist only in memory and never in
  URLs, session storage, logs, or error payloads

Exit proof:

- Known-answer unit tests cover encryption, wrong-passphrase failure, envelope
  versioning, and Public Key derivation.
- Browser tests cover create, reload/unlock, failed unlock, forget/re-enter, and
  Sign Out while verifying the Coco database remains.

## Slice 3: Remote Signer Pairs and Reconnects

**Recipient outcome:** A Recipient can connect a remote signer from a
`nostrconnect://` QR, complete authorization, reload into a visible reconnecting
state, and Sign Out locally even when the remote signer is unavailable.

End-to-end path:

1. **Connect remote signer** generates one-time pairing material.
2. A phone-first pairing surface presents QR and copy alternatives, connection
   progress, timeout, and Cancel.
3. The NIP-46 state machine handles relays, the one-time secret, `auth_url`, and
   `get_public_key`, then verifies the actual Recipient Public Key.
4. Only the established connection record is persisted; incomplete pairing
   secrets are erased.
5. Reload restores the connection into an explicit reconnecting state and
   opens the Public-Key-selected wallet only after verification.
6. Sign Out attempts remote logout, then always removes the local client key
   and connection record before closing the wallet runtime.

UI composition:

- Responsive `Drawer` with required title, QR presentation, copy action,
  `Spinner`, progress text, authorization action, and Cancel
- Reconnection `Alert`, session-state `Badge`, and local Sign Out action

Required failure behavior:

- Timeout, user cancellation, bad one-time secret, relay loss, rejected
  authorization, unexpected Public Key, and remote logout failure
- Reconnect never flashes or opens a wallet belonging to an unverified key

Exit proof:

- Protocol state-machine tests cover three distinct NIP-46 keys, `auth_url`
  correlation, relay switching, cancellation cleanup, and reconnect.
- Browser tests cover QR/copy pairing, reload/reconnect, mismatch, offline
  remote signer, and best-effort Sign Out.

## Slice 4: A Paid npub.cash Quote Becomes Balance

**Recipient outcome:** While the Wallet is open, an ordinary paid npub.cash
quote is discovered, claimed automatically, persisted by Coco, and reflected
once in the total and per-mint balances.

End-to-end path:

1. The signer supplies npub.cash authentication through the existing NIP-98 or
   short-lived JWT boundary.
2. The NPC plugin account starts with the Wallet Runtime and discovers quotes.
3. The plugin imports and executes a durable Coco claim operation against the
   server-selected trusted mint.
4. Coco's persisted quote, operation, proof, and event state drives the claim
   projection; the plugin synchronization return value does not declare
   success.
5. `/wallet` shows checking, active claim amount, quiet success notification,
   updated total balance, and per-mint breakdown.
6. Reload and repeated synchronization observe the same processed operation
   and do not mint or count it twice.

UI composition:

- Compact sync status with `Spinner`
- Active/failing claim `Alert`, state `Badge`, Base UI `toast` on success
- Balance composition and mint `Collapsible`

Required failure behavior:

- API unavailable, signer authorization failure, mint unavailable, claim
  pending across reload, already processed quote, and malformed quote
- A quote marked `locked` is not submitted to Coco and is identified as
  **Protected payment unsupported**
- Offline state is explicit; the app makes no offline-capability claim

Exit proof:

- Integration tests use a real pinned Manager/NPC path with deterministic API
  and mint boundaries.
- Browser tests prove one claim across reload/repeated sync, balance aggregation
  across two mints, visible split by mint, and no locked-quote attempt.

## Slice 5: Claim Problems Can Be Understood and Recovered

**Recipient outcome:** A Recipient can see what happened to a claim, reopen its
durable operation after reload, and retry only work that Coco identifies as
recoverable.

End-to-end path:

1. `/activity` projects Coco history into date-grouped claim rows.
2. `/activity/:operationId` loads one existing Coco operation by identifier.
3. Pending and executing operations reconcile through Coco recovery.
4. Recoverable failures expose a precise retry action; terminal failures expose
   details without creating replacement operations.
5. The Wallet claim notice links to the durable detail route.

UI composition:

- `Item` groups, state `Badge`s, `Empty`, and initial `Skeleton`
- Operation summary, technical-details `Collapsible`, recovery `Alert`, and
  command `Spinner`

Required failure behavior:

- Unknown operation ID receives a route-level not-found state
- Runtime-open failure receives a route error boundary
- Retry cannot bypass Coco's persisted state or create an unrelated new claim

Exit proof:

- Projection tests cover every mapped Coco claim state.
- Browser tests cover empty history, successful claim detail, reload while
  pending, recoverable retry, terminal failure, and unknown operation.

## Slice 6: Ecash Can Be Sent, Reopened, and Reclaimed

**Recipient outcome:** A Recipient can create an ecash token from one eligible
mint, review the exact amount and fee, share it, reopen it after reload, and
explicitly reclaim it while still unspent.

End-to-end path:

1. `/send/ecash` accepts an amount and derives eligible single-mint choices.
2. Selection prefers the current npub.cash mint when it is capable and funded;
   the Recipient may choose another eligible mint.
3. Coco prepares one operation and `/send/ecash/:operationId` owns its review
   and subsequent lifecycle.
4. Explicit confirmation executes the persisted prepared operation once.
5. Coco's stored token is re-encoded after reload for QR, text, copy, and native
   share; no parallel token store is created.
6. A confirmed reclaim invokes Coco for the existing unspent operation and
   communicates that the shared token becomes invalid.

UI composition:

- `FieldGroup`, `InputGroup`, amount `Input`, and mint `Select`
- Full review `Card`
- Responsive titled `Drawer`/`Dialog` confirmation
- Repo-native QR presentation with text alternative and copy/share `Button`s
- Destructive reclaim `AlertDialog`, operation `Badge`, `Alert`, and `Spinner`

Required failure behavior:

- Invalid amount, insufficient total balance, total sufficient but split across
  mints, fee/amount changes during prepare, expired preparation, mint failure,
  and share API absence
- Prepared executes only on explicit confirmation
- Executing is reconciled and never re-executed by the route
- Pending without a stored token is a recovery exception and never offers a
  replacement-token shortcut
- Reclaim is never automatic or based only on time

Exit proof:

- Policy tests cover mint selection and split-balance explanations.
- Browser tests cover prepare/cancel/confirm, reload in prepared/executing/
  pending states, byte-equivalent token re-presentation, spent detection,
  reclaim cancel/confirm, and duplicate-execution prevention.

## Slice 7: A Lightning Invoice Can Be Paid and Reconciled

**Recipient outcome:** A Recipient can paste or scan a BOLT11 invoice, review
destination, amount, expiry, selected mint, and maximum fee, confirm once, and
later see the correct settlement outcome.

End-to-end path:

1. `/send/lightning` validates a BOLT11 invoice and requests an amount for an
   amountless invoice.
2. Eligible mint selection follows the one-mint policy proven by Slice 6.
3. Coco prepares a melt and `/send/lightning/:operationId` owns review and
   lifecycle.
4. Explicit confirmation executes once.
5. Executing or pending payments reconcile through Coco after reload.
6. Finalized, expired, failed, and rolled-back outcomes render from persisted
   state and appear in Activity.

UI composition:

- Invoice `Field`/`InputGroup`, optional amount `Field`, mint `Select`
- Full review `Card`, responsive confirmation, settlement `Badge`, `Alert`, and
  `Spinner`
- Camera scanning may be added only through a reviewed local dependency and
  must retain paste as the complete alternative

Required failure behavior:

- Invalid or expired invoice, amount mismatch, unsupported unit, insufficient
  one-mint balance, preparation failure, payment pending, definitive failure,
  and ambiguous transport loss
- No pending or failed route creates a replacement payment implicitly

Exit proof:

- Invoice and fee policy tests cover fixed and amountless invoices.
- Browser tests cover prepare/cancel/confirm, expiry before confirmation,
  reload while pending, finalized settlement, rollback/failure, and
  duplicate-payment prevention.

## Slice 8: Wallet and npub.cash Settings Are Manageable

**Recipient outcome:** A Recipient can understand their Wallet and signer,
change the preferred mint for future payments, handle unsupported quote
locking, choose appearance, and Sign Out without confusing those actions with
moving or deleting funds.

End-to-end path:

1. `/settings` provides focused routes for mints, signer, recovery, appearance,
   Recipient Address, and Username.
2. `/settings/mints` shows per-mint balances/trust and validates a proposed mint
   URL by fetching its information and required capabilities.
3. Confirming a preferred mint updates npub.cash settings but does not migrate
   existing balances.
4. If `lockQuote` is enabled, Settings explains incompatibility and offers a
   confirmed disable action for future payments only.
5. `/settings/signer` shows current signer mode and session state using the
   adapters already delivered.
6. Appearance uses the existing semantic light/dark theme without changing
   financial or runtime state.

UI composition:

- `Item` rows and `Separator`s rather than a wall of cards
- Mint URL `Field`, validated summary `Card`, custodial and locked-quote
  `Alert`s, capability `Badge`s, and confirmation `Dialog`
- Appearance `ToggleGroup`

Required failure behavior:

- Malformed, unreachable, or incompatible mint; changed server setting;
  authorization rejection; and future-only locking warning
- Disabling locking never claims, unlocks, or implies recovery of an existing
  locked quote

Exit proof:

- Contract tests cover mint validation and setting mutation.
- Browser tests cover invalid/valid mint review, future-only preferred-mint
  change, per-mint balances, lock warning/disable confirmation, appearance
  persistence, and Sign Out preserving Wallet Material.

## Slice 9: A Recipient Username Can Be Purchased Safely

**Recipient outcome:** A Recipient can check a username, accept the displayed
provisional price and mint, submit the opaque X-Cashu purchase once, and see
either ownership, a definite rejection, or an honest ambiguous-status state.

End-to-end path:

1. `/username` accepts and validates a candidate name.
2. **Check and claim** calls `setUsername(name, false)`.
3. A free result may assign immediately; a paid result displays provisional
   price and mint terms and explains that confirmation rechecks them.
4. **Pay and claim username** calls `setUsername(name, true)` once and remains
   disabled while active.
5. Success is confirmed from Recipient ownership.
6. An ambiguous network outcome enters persistent **Purchase status unknown —
   checking** and polls Recipient information without creating another payment.

UI composition:

- Username `Field`, `Input`, validation `FieldError`, and command `Button`
- Paid terms using full `Card` composition
- Persistent ambiguity `Alert`, active `Spinner`, and result `Badge`

Required failure behavior:

- Invalid or unavailable username, changed paid terms, insufficient eligible
  balance, definite business rejection, transport ambiguity, reload while
  status is unknown, and status-check exhaustion
- The frontend never retries payment automatically, offers a blind pay-again
  action, or infers purchase state from unrelated Coco Sends
- Later check/support remains available when ownership cannot be confirmed

Exit proof:

- State-machine tests prove at-most-one frontend submission per explicit user
  confirmation and cover free, paid, rejected, ambiguous, and confirmed-owned
  paths.
- Browser tests inject response loss after submission and prove that no second
  payment is created.
- The known server-side paid-but-unassigned reconciliation concern remains
  linked and separately tracked; it does not weaken the frontend gate.

## Slice 10: Release Candidate Proven at `wallet.npub.cash`

**Recipient outcome:** The complete Claim Companion is deployable on its stable
dedicated origin and its supported financial and signer flows behave consistently
across target browsers.

This convergence slice may repair integration defects, but it may not defer
feature-owned error states, persistence, accessibility, or tests from earlier
slices.

Deliver:

- Dedicated `wallet.npub.cash` build and hosting path with SPA history fallback
- Credential-free, narrowly scoped API CORS with `X-Cashu` exposure and NIP-98/
  JWT protection for authenticated operations
- Restrictive CSP permitting only the API, selected mints, and configured
  NIP-46 relays; no third-party runtime scripts, frames, or objects
- HSTS, Referrer-Policy, nosniff, and explicit Permissions Policy
- No PWA manifest behavior, service worker, offline shell, analytics, remote
  telemetry, or diagnostic export
- Restrained production logging and source-map policy appropriate for wallet
  code
- IndexedDB migration fixtures for the pinned dependency tuple and every
  application-owned schema
- Complete Chromium and WebKit financial-flow suites plus Firefox smoke suite
- Manual current-version passes in Chrome/Brave desktop, Firefox desktop,
  Safari desktop, Chrome Android, and Safari iOS

Exit proof:

- Frozen-lockfile install, exact peer check, typecheck, lint, unit/integration/
  browser tests, migration tests, and production build all pass.
- A clean profile can complete every supported signer path, automatically claim
  a payment, send ecash, pay Lightning, purchase a username, reopen durable
  operations, and Sign Out/reopen the same Public-Key wallet.
- Custody, seed selection, duplicate claiming/payment, resumption, or migration
  failures block release.

## Work That Is Deliberately Not a Slice

The following remain outside the first-release map and must not appear as
opportunistic scope inside another slice:

- On-chain Sends
- Generic Cashu token import or Lightning receive
- Wallet restore/import, device synchronization, or multi-device detection
- `bunker://` input
- NUT-20 locked-quote claiming or rescue of existing locked quotes
- Offline capabilities, PWA installation, or service-worker caching
- A parallel application history or token database
- Third-party analytics, remote telemetry, or diagnostic export
- Server-side Username Purchase idempotency and paid-but-unassigned
  reconciliation

## Tracking Rule

Track delivery by slice and its exit proof, not by architecture layer or file
count. A pull request may contain one slice or a coherent subset that leaves the
branch green, but the product checklist advances only when the entire
Recipient outcome is demonstrable end to end. Any newly discovered dependency
is attached to the earliest slice whose outcome requires it; it does not become
an unowned cross-cutting backlog item.
