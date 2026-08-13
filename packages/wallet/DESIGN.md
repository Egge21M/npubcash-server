# npub.cash Wallet Design

Status: accepted

This document records the agreed product design, architecture, and functionality
of the npub.cash web wallet. It is intentionally a clean-sheet design: the
previous wallet implementation is not an architectural or interaction-design
baseline.

## Purpose

Define a Claim Companion that gives a Recipient a clear, safe way to discover
and claim payments received through npub.cash, then move the resulting ecash
out through a small set of send operations. This accepted design is the
implementation baseline for the first-release frontend.

## Verified System Context

- `packages/wallet` is a React 19 and TypeScript Vite application using
  shadcn/ui with Base UI primitives and Tailwind CSS v4.
- The npub.cash server authenticates protected operations using Nostr NIP-98 or
  a short-lived JWT obtained with NIP-98.
- The server exposes paid mint quotes and Recipient settings, including the
  preferred mint, optional Recipient Address username, and quote locking.
- The server deliberately continues returning paid quotes after they have been
  issued or spent. A wallet must therefore maintain its own knowledge of which
  quotes it has processed.
- The server currently serves the landing-page build from `packages/frontend`.
  The accepted wallet deployment is a separate `wallet.npub.cash` origin and
  therefore requires its own hosting path.

## Framework Research Snapshot

The initially evaluated stable framework baseline was verified against Coco
v1.0.1 and current primary sources on 2026-08-12. Detailed findings and
citations live in
[`COCO-RESEARCH.md`](./COCO-RESEARCH.md) and
[`SIGNER-PERSISTENCE-RESEARCH.md`](./SIGNER-PERSISTENCE-RESEARCH.md).

- Stable Coco uses the namespaced `@cashu/coco-core`,
  `@cashu/coco-indexeddb`, and optional `@cashu/coco-react` packages. Its
  supported browser persistence adapter is IndexedDB, not SQLite.
- Coco v1.0.1 targets TypeScript 5. The wallet starter currently declares
  TypeScript 6 and must be aligned before integration.
- The published npub.cash Coco plugin targets the previous release-candidate
  `coco-cashu-*` packages and cannot be combined with stable Coco unchanged.
- Coco persists proofs, operations, history, mints, keysets, and related wallet
  state, but deliberately does not persist the BIP-39 wallet seed. The
  application must supply and retain that seed.
- Stable Coco supports Cashu ecash sends and BOLT11 Lightning melts. It has no
  built-in on-chain operation handler; NUT-30 on-chain support remains optional
  at the mint layer.
- Coco does not own Nostr identity, NIP-07, direct nsec handling, NIP-46, or
  npub.cash authentication. Those belong to application-owned services above
  Coco.
- Plain browser storage is origin-scoped but not confidential from code running
  on the same origin. Encrypting signer credentials does not encrypt or protect
  Coco's spendable proofs.

The project has subsequently chosen the Coco v2 release-candidate line and the
nightly npub.cash plugin instead of the stable v1 baseline. The compatible
package tuple and atomic upgrade policy are accepted below.

Current v2 research is captured in [`COCO-V2-RESEARCH.md`](./COCO-V2-RESEARCH.md).
As of 2026-08-12, the NPC nightly has an exact peer dependency on Coco RC1 even
though Coco's moving `rc` tag points to RC3. The only compatible published tuple
is:

- `@cashu/coco-core@2.0.0-rc.1`
- `@cashu/coco-indexeddb@2.0.0-rc.1`
- `@cashu/coco-react@2.0.0-rc.1`
- `coco-cashu-plugin-npc@3.0.0-rc.20260707.3.1.sha.debd5dd`
- TypeScript 5.9.3

RC1 lacks later concurrency and retry fixes. In particular, application code
must serialize first-time seed creation, refuse to invent a replacement seed
when an existing Wallet Installation has lost its seed, and exercise claim and
operation recovery in real-browser compatibility tests.

Locked-quote compatibility is captured in
[`LOCKED-QUOTE-RESEARCH.md`](./LOCKED-QUOTE-RESEARCH.md). The selected tuple
cannot correctly claim NUT-20-locked BOLT11 quotes. Attempting one unsigned can
leave a pending Coco operation that NPC synchronization subsequently treats as
already tracked. NIP-07 and standard NIP-46 also cannot sign arbitrary NUT-20
messages. Quote locking therefore requires a coordinated future server, API,
Coco, plugin, and key-derivation design; it is not a UI-only omission.

## Design Principles

- No behavior or structure is inherited merely because the previous wallet had
  it.
- Security- and custody-relevant behavior must be visible to the Recipient and
  have an explicit failure and recovery model.
- Domain terms are shared with the repository glossary in `CONTEXT.md`.
- Unsettled decisions remain visibly unsettled rather than becoming implicit
  implementation assumptions.
- The interface is designed for Nostr users who may know little about Cashu.
  Protocol details are shown only when they affect trust, recovery, or a
  required action.
- The primary experience is optimized for phones while remaining responsive on
  desktop browsers.
- Wallet Material remains entirely client-side. The npub.cash server must never
  receive a wallet seed or spendable ecash proofs.
- Coco is the wallet framework. The previous Coco-based wallet behavior is
  evidence that the core approach works, but its application architecture and
  signer-session persistence are not a baseline for the new app.
- All interface design and implementation follows the workspace shadcn skill,
  the wallet's actual shadcn project context, and current component
  documentation. Existing shadcn components and variants are preferred over
  custom equivalents.

## Shadcn Project Context

The normative interface baseline is the current `components.json` and shadcn
CLI project context:

- Vite SPA with React and TypeScript; no React Server Components
- Tailwind CSS v4 with the global theme in `src/index.css`
- Base UI primitives using the Base/Vega style
- Purple theme with mauve base color and semantic CSS variables
- Inter typography and Lucide icons
- `@/` import aliases
- Base UI custom triggers use `render`

Only `button` is currently installed. Components are added from an explicitly
selected registry only when their design use is accepted. Before implementation,
the current shadcn docs and examples are fetched for every component being
created or used.

## Design Status

The design interview is complete. The product, custody, signer, persistence,
Coco, claim, Send, routing, deployment, shadcn composition, and release-gate
branches have shared agreement. Implementation is a separate subsequent task.

## Architecture at a Glance

```text
React Router + shadcn screens
  └─ WalletRuntimeProvider
      ├─ Signer subsystem
      │   ├─ NIP-07 adapter
      │   ├─ Direct-nsec encrypted vault
      │   └─ NIP-46 connection state machine
      ├─ Wallet registry
      │   ├─ Public Key → Wallet Installation
      │   └─ Recovery Phrase + database metadata
      └─ CocoCashuProvider / Coco Manager
          ├─ NPC plugin account
          ├─ Coco React hooks
          └─ Public-Key-named IndexedDB repositories

External boundaries
  ├─ npub.cash API — identity, settings, quotes, username
  ├─ Cashu mints — claim, ecash Send, Lightning melt
  └─ NIP-46 relays — remote signer transport
```

The Nostr Signer selects and authenticates the Recipient. The Wallet Registry
selects the local Wallet Installation. Coco owns proofs, financial history, and
durable Cashu operations. React renders explicit state through shadcn
compositions and does not own protocol or persistence lifecycles.

## Decisions

### Product Boundary

The product is a Claim Companion for npub.cash, not a general-purpose Cashu
wallet. It discovers and claims npub.cash quotes, makes the resulting ecash
available locally, and sends value out as Cashu ecash or Lightning in the first
release. On-chain Bitcoin remains a later product capability.

### Audience and Form Factor

The primary Recipient already uses Nostr but may not understand Cashu. The
experience is phone-first and responsive on desktop.

### Custody Boundary

Custody is fully client-side. Wallet seeds and proofs do not leave the device
unless the Recipient later invokes an explicitly designed export or recovery
mechanism.

### Wallet Framework

Coco provides the wallet framework. Application architecture should expose
Coco through a deliberate boundary rather than scattering framework access
through presentation components.

### Previous-Wallet Lesson

The previous wallet and its Coco integration worked adequately. The known weak
area was persistence and restoration across the supported Nostr sign-in modes:
an entered nsec, a browser extension, and an NIP-46 signer connection. General
NIP-46 support also needs a more complete lifecycle and recovery model.

### Payment Lifecycle

The companion uses this lifecycle:

1. Discover a paid npub.cash mint quote as a Pending Payment.
2. Claim the Pending Payment by asking its mint to issue proofs from the quote.
3. Persist the issued proofs locally and include their value in the wallet
   balance.
4. Send spendable value out as ecash or Lightning. On-chain Bitcoin is deferred.

“Redeem” is a synonym for “claim” in this context, not a separate lifecycle
stage. Product language uses “claim” consistently.

### Supported Nostr Signers

The first release supports:

- A directly entered nsec
- A NIP-07 browser extension
- An app-initiated NIP-46 connection using a `nostrconnect://` URI

Entering an existing `bunker://` connection is not part of the first-release
signer set.

Signer persistence is mode-specific:

- Direct nsec: persist the Identity Secret in a versioned encrypted vault. A
  passphrase is required once at the start of each browser session to decrypt
  it. Plaintext key material remains in memory only for that session.
- NIP-07: persist only the expected Public Key. On restoration, reacquire the
  extension and require it to report the expected Public Key.
- NIP-46: persist the established connection record, including its client
  connection key, without a local passphrase. The connection key is not the
  Recipient's Identity Secret; the remote signer remains the authorization
  gate.

NIP-46 restoration displays a visible reconnecting state and offers Sign Out.
The Wallet opens only after the restored remote signer reports the expected
Public Key.

A direct-nsec passphrase is required for every fresh application runtime,
including page reload and a reopened tab. Neither the decrypted Identity Secret
nor a key capable of decrypting it is placed in `sessionStorage` or other
persistent browser storage.

### Signer Gate

An active Nostr Signer whose Public Key matches the wallet is required to open
the wallet interface. This gate establishes the active Recipient and is a UX
boundary, not encryption or a security boundary: the proof database is an
unencrypted IndexedDB database and remains accessible to code executing in the
same origin.

### Sign-in Experience

The unauthenticated entry is one focused sign-in surface using full shadcn
`Card` composition:

- NIP-07 is the primary action when a browser extension is detected.
- **Connect remote signer** starts the app-initiated NIP-46 flow.
- **Use an nsec** is an advanced disclosure with an `Alert` explaining the
  stronger local-secret responsibility.

The NIP-46 flow uses a phone-first `Drawer` containing the QR code, copy action,
connection progress, authorization action, and Cancel. Direct-nsec setup uses
`FieldGroup` and `Field` for the nsec, passphrase, and confirmation, including
`data-invalid`, `aria-invalid`, and `FieldError` validation states.

### Identity and Wallet Cardinality

Within one browser storage partition, a Public Key selects one local Wallet
Installation. Wallet state for different Public Keys must remain strictly
separated and may never be merged implicitly.

The same Public Key can independently open the companion on multiple devices or
browser profiles. Each gets a separate Wallet Installation. The app does not
attempt to detect, synchronize, or reconcile those installations.

### Wallet Seed and Local Database

Each Wallet Installation receives an independently generated 12-word BIP-39
Recovery Phrase using `@scure/bip39`. Coco's 64-byte seed is derived from that
phrase. The Recovery Phrase is associated with, but is not derived from, the
Recipient's Nostr key.

The seed may be stored unencrypted in local browser storage. This does not
materially weaken the current storage boundary because the spendable proof
database is also unencrypted. It is stored in a versioned IndexedDB wallet
registry keyed by Public Key and separate from the Public-Key-named Coco
database.

The Recipient Public Key determines the name or namespace of the local Coco
IndexedDB database.

The companion shows the Recipient their seed with an explanation that clearing
browser data or losing the browser profile loses this Wallet Installation and
causes a future sign-in to create a new seed and wallet. The first release does
not provide a restore function. Displaying the seed must not be described as a
working in-app recovery mechanism.

Wallet creation shows the browser-data-loss warning but does not force the
Recipient to transcribe or verify Recovery Phrase words. Settings provides a
confirmation-gated **Reveal recovery phrase** action and reiterates that this
release cannot import or restore it.

Seed creation is serialized across tabs. If a Public-Key-named Coco database
already exists but its Recovery Phrase record is missing, the companion refuses
to open it and never silently creates a replacement seed. It presents a local
data inconsistency with Sign Out and an explicitly destructive local-removal
path.

### Signer Availability Check

Opening a Wallet requires persisted signer configuration that appears
operational and resolves to the Wallet's expected Public Key. Opening does not
require a new signature. The exact operational check is specific to each signer
mode and remains to be specified.

If a Recipient forgets the passphrase protecting a direct-nsec signer record,
they may forget that encrypted signer record and enter the same nsec again. The
derived Public Key selects the existing Wallet Installation, and the Recipient
sets a new passphrase. This flow never removes Wallet Material or creates a new
seed.

### Direct-nsec Encryption

Creating a direct-nsec Signer Session requires a passphrase and confirmation
with a reasonable minimum length and no composition rules. A versioned
authenticated-encryption envelope uses WebCrypto PBKDF2 with a unique salt and
calibrated work factor to derive an AES-GCM key. Forgetting the passphrase is
recovered by forgetting the signer record and re-entering the original nsec,
not by recovering the passphrase.

### Sign Out

Signing out closes the wallet UI and deletes the persisted signer
configuration. It does not delete the local Coco database, proofs, history, or
wallet seed. A later sign-in with the same Public Key reopens that Public Key's
existing local Wallet Installation; another Public Key selects a different
database automatically.

The first release has no implied local-wallet deletion behavior. If deletion is
added, it must be a separate explicitly destructive operation.

### Coco Integration Line

The companion will use Coco v2 release candidates and the nightly release of
the npub.cash Coco plugin. It will not build against stable Coco v1 or create a
replacement application-owned quote bridge unless this decision is revisited.

The instability and compatibility risks of this release line are accepted. The
wallet pins every Coco and NPC package to an exact compatible version and
commits the generated lockfile. Moving tags and semantic version ranges are not
used. The team controls both projects and may make compatibility adjustments,
but the wallet upgrades the tuple together only after its compatibility suite
passes. See [`docs/adr/0001-pin-coco-v2-rc-and-npc-nightly.md`](../../docs/adr/0001-pin-coco-v2-rc-and-npc-nightly.md).

The application owns the Coco Manager lifecycle. Runtime signer and plugin
account objects are created once per opened Wallet rather than during React
renders. Sign Out disposes the Manager and closes its IndexedDB connection
before another Public Key's Wallet is opened.

### Initial Send Capabilities

The first release supports Cashu ecash sends and BOLT11 Lightning payments.
On-chain sends are excluded from the first release and may be added later when
the selected Coco version and product design are ready for them.

### Incoming-Payment Boundary

The only receive path is through npub.cash. The companion does not import
external Cashu tokens and does not provide a generic Lightning receive flow.

While the Wallet is open, the npub.cash Coco plugin discovers and automatically
claims new Pending Payments. The Recipient does not approve each claim. The
interface must represent claim progress and recoverable failures without
pretending that automatic work is instantaneous.

The plugin's synchronization return value is not proof that every claim
succeeded. Coco's persisted quotes, operations, and events are the authoritative
source for claim progress and recovery. The plugin automatically trusts mint
URLs returned by npub.cash, and the product accepts that policy for this receive
path.

### Balance Model

The primary balance is the sum of spendable value across all trusted mints in
the Wallet. The interface also provides a per-mint breakdown so the Recipient
can understand custody and why a requested Send may not be fundable by one mint.

Each Send uses one mint. The companion first prefers the Recipient's current
npub.cash mint when it has sufficient balance and supports the requested rail,
then another eligible mint. The confirmation shows the selected mint and lets
the Recipient change it. If the total balance covers the amount but no single
Mint Balance does, the interface explains that the funds are split across
mints.

### Ecash Send

An ecash Send follows a durable operation lifecycle:

1. The Recipient enters an amount.
2. The companion prepares the operation and shows amount, fee, and selected
   mint for confirmation.
3. Coco executes the operation and the companion encodes the resulting token.
4. The companion presents the bearer token as text and QR code with copy and
   native-share actions.
5. The Send remains pending until the proofs are spent.
6. The Recipient may explicitly reclaim an unspent token after acknowledging
   that reclaiming invalidates the shared token.

The companion never automatically reclaims a token based only on elapsed time.

### Lightning Send

A Lightning Send follows this lifecycle:

1. The Recipient pastes or scans a BOLT11 invoice.
2. The companion validates it. For an amountless invoice, it asks for the
   amount before preparing a payment.
3. The companion prepares the melt and presents destination information,
   amount, expiry, selected mint, and maximum total fee.
4. The Recipient explicitly confirms.
5. Coco executes the melt.
6. The companion represents finalized, pending, expired, and failed outcomes
   distinctly. Coco reconciles pending settlement after reload.

### Claim Feedback

Automatic claiming succeeds quietly and fails prominently:

- A compact synchronization indicator appears while checking npub.cash.
- An active operation reports the amount being claimed.
- Success produces a brief balance update notification and a durable Activity
  entry.
- Failure produces a visible notice, retry action, and optional technical
  details.
- A manual claim queue appears only for work automatic processing could not
  complete.

### History Ownership

Coco is the sole owner and persistence source for financial history in the
first release. The companion does not create a parallel application history
store. Activity presentation uses Coco's React APIs and persisted operation
state.

Activity uses shadcn `Item` rows grouped by date with `Badge` states and `Empty`
when no history exists. The phone layout does not switch to a desktop-first
`Table`. Stable detail routes own full operation details; a `Drawer` may provide
quick inspection without replacing those routes.

### Information Architecture

The authenticated companion has three primary destinations:

- **Wallet**: total balance, per-mint breakdown, Recipient Address, current
  claim activity, Send Ecash, and Pay Lightning
- **Activity**: claims, ecash Sends, Lightning Sends, pending operations, and
  recoverable failures
- **Settings**: signer/session details, Recovery Phrase, npub.cash and mint
  settings, appearance, and Sign Out

Navigation is phone-first bottom navigation with a compact desktop adaptation.
The companion does not use a dashboard sidebar.

The official configured shadcn registry has no bottom-navigation component.
The navigation is therefore a small repo-native semantic `nav` composed from
shadcn `Button` ghost variants and Lucide icons, with visible labels and
route-aware `aria-current`. Desktop uses the same destinations in a compact top
navigation rather than a separate model.

### Send Routes and Overlays

Ecash and Lightning Sends live at stable `/send/ecash` and `/send/lightning`
routes so durable operations can resume after reload. Entry uses `FieldGroup`
and `InputGroup`; prepared review uses full `Card` composition. Final
confirmation uses a responsive `Drawer` on phones and `Dialog` on larger
screens. `AlertDialog` is reserved for destructive operations such as reclaim.
The Base UI `toast` component reports brief success feedback.

### Routing

The companion uses React Router. Its accepted route map is:

- `/` — sign-in or redirect to Wallet
- `/wallet`
- `/activity`
- `/activity/:operationId`
- `/send/ecash`
- `/send/ecash/:operationId`
- `/send/lightning`
- `/send/lightning/:operationId`
- `/settings`
- `/settings/mints`
- `/settings/signer`
- `/settings/recovery`
- `/username`

Sensitive invoices, encoded tokens, Identity Secrets, passphrases, and Recovery
Phrases never appear in paths, query strings, or browser history.

Routing uses React Router Data Mode with one `createBrowserRouter` created
outside React state. Nested route objects provide layouts and route error
boundaries; route modules may be lazily loaded. The companion does not adopt
React Router Framework Mode or build-time rendering.

### Operation Route Resumption

Operation detail routes load the existing Coco operation by `operationId`; they
never infer that a missing operation should be recreated.

For `/send/ecash/:operationId`:

- A prepared operation may execute only after explicit Recipient confirmation.
- A normal pending operation contains the full persisted token. The route
  re-encodes that token through Coco and restores QR, copy, share, status, and
  reclaim actions without a parallel token store.
- An executing operation is handed to Coco recovery and rendered as
  reconciling. It is never executed again by the route.
- A pending operation without its persisted token is a recovery exception and
  does not offer **Create another token**.
- Finalized, reclaiming, reclaimed, failed, and other terminal states are
  rendered from persisted Coco state.

For `/send/lightning/:operationId`:

- A prepared melt executes only after explicit confirmation.
- Executing and pending melts are reconciled through Coco recovery and refresh.
- Finalized, expired, failed, and rolled-back outcomes render their persisted
  result and never create a replacement payment implicitly.

These contracts follow the pinned Coco RC1 persistence behavior documented in
[`COCO-V2-RESEARCH.md`](./COCO-V2-RESEARCH.md).

### Loading, Empty, and Failure States

- `Skeleton` represents initial data-shaped loading.
- `Spinner` represents an active command.
- `Empty` represents no Activity.
- `FieldError` represents input validation failure.
- `Alert` represents recoverable connection, claim, mint, or payment failure.
- A full-page error boundary represents failure to open the Wallet Runtime
  safely.
- `AlertDialog` confirms destructive recovery, including removal of a stranded
  Wallet Installation.

Ambiguous payment states retain their Coco operation and domain identifiers and
present explicit reconciliation state. They never collapse to an unqualified
“try again” action that might create another payment.

### Connectivity and Installation

The first release is online-only. It does not promise or expose offline balance
access, offline ecash creation, or other offline operations. Network
unavailability is detected before entering or acting in the Wallet and is shown
as an explicit unavailable state.

The first release is not a Progressive Web App and is not installable. It does
not register an application service worker or cache an offline application
shell.

### React Integration

The companion uses `@cashu/coco-react` and its provider and hooks directly for
Coco-owned wallet state, history, balances, and durable operations.

One application-owned `WalletRuntimeProvider` restores the Nostr Signer and
seed, creates Coco and the NPC account once, and disposes the Manager and closes
IndexedDB correctly. Beneath it, feature components may use official Coco React
hooks. Presentation components do not create Managers, switch identities, or
touch persistence. The application does not build a duplicate wrapper service
for every Coco hook.

### Wallet Creation and Reinitialization

If a Recovery Phrase exists but the Public-Key-named Coco database is missing,
the companion recreates an empty database using that same Recovery Phrase and
warns that local proofs and history are absent. It never replaces the phrase
automatically.

### NIP-46 Pairing and Sign Out

App-initiated NIP-46 pairing:

1. Generates a one-time `nostrconnect://` URI
2. Presents QR and copy actions
3. Shows connection progress with a bounded timeout and Cancel
4. Opens and continues tracking an `auth_url` response when required
5. Validates the one-time pairing secret
6. Fetches and verifies the Recipient Public Key
7. Persists only the established connection record
8. Erases incomplete pairing material on cancel or failure

NIP-46 Sign Out sends a best-effort remote logout request, then always deletes
the local connection key and record. Remote failure never blocks local Sign
Out.

### Wallet Initialization Experience

After signer verification, one staged initialization screen reports:

1. Verifying signer
2. Opening local Wallet
3. Starting Coco
4. Connecting npub.cash
5. Checking payments

The active step uses `Spinner` and semantic live status text rather than a fake
percentage. A new Wallet pauses after Recovery Phrase creation to show the
browser-data-loss `Alert`; an existing Wallet proceeds automatically. A
runtime-opening failure uses a full-page error boundary only when the Wallet
cannot open safely.

### First-Release Settings

The first release includes:

- Recipient Address display and copy
- Preferred npub.cash mint selection
- Per-mint balances and trust details
- Recipient Username purchase
- Nostr Signer and Signer Session information
- Recovery Phrase reveal
- Appearance
- Sign Out

Preferred-mint changes accept a URL, fetch and validate mint information, and
show the mint hostname, relevant capabilities, and custodial warning before
confirmation. Malformed, unreachable, or incompatible mints are rejected.
Changing the preferred mint affects only future npub.cash payments and never
migrates existing Mint Balances.

Username purchase behavior is detailed in
[`USERNAME-PURCHASE-RESEARCH.md`](./USERNAME-PURCHASE-RESEARCH.md). The pinned
tuple implements the happy path, but the current plugin and server do not
provide end-to-end idempotency. A lost response or crash can otherwise create
an ambiguous paid purchase or a duplicate Cashu Send.

Username purchase is required in the first release and uses the current
`X-Cashu` in-band happy path. Server-side atomicity, purchase identifiers, and
idempotent reconciliation are acknowledged follow-up work outside the frontend
implementation scope of this design.

The frontend never responds to an ambiguous outcome by automatically creating
a second payment.

The current NPC helper exposes an opaque frontend contract:

- `setUsername(name, false)` returns a provisional Payment Request when payment
  is required, but assigns the username immediately when the configured price
  is zero.
- `setUsername(name, true)` fetches a fresh Payment Request and completes the
  Coco payment internally. It does not reuse or compare the reviewed request.
- The helper exposes no Coco operation ID, encoded token, submission stage, or
  purchase receipt to the frontend.

After an ambiguous network result, the frontend displays **Purchase status
unknown — checking** and polls Recipient information. It marks success only
when that Recipient owns the requested normalized username. It never infers the
purchase from unrelated Coco pending Sends and never offers blind repayment.

The accepted frontend interaction is:

1. Enter the username using shadcn `Field` and `Input`.
2. Select **Check and claim**.
3. Call `setUsername(name, false)`. A free username may be assigned immediately;
   a paid username returns provisional price and mint terms.
4. Present paid terms using full `Card` composition and explain that the plugin
   rechecks terms when payment is confirmed.
5. Select **Pay and claim username** once. Disable repeat submission while the
   opaque plugin call is active.
6. Present definite business rejection as a specific recoverable error.
7. Present network ambiguity as a persistent **Purchase status unknown —
   checking** `Alert` and poll Recipient information.
8. If ownership cannot be confirmed, offer later status checking or support,
   never another automatic payment.

The pinned first-release tuple cannot safely claim locked quotes. The first
release therefore:

- Does not expose an enable-locking control
- Detects `lockQuote: true` and presents a prominent incompatibility notice
- Offers an explicitly confirmed action to disable locking for future payments
- Never submits a claim attempt for a quote marked `locked`
- Represents an existing locked quote as **Protected payment unsupported**

Disabling the Recipient setting affects only future invoices. It does not
unlock or rescue existing paid quotes.

Settings uses `Item` rows and `Separator`s leading to focused subroutes rather
than a wall of `Card`s. Wallet shows the mint breakdown in `Collapsible`;
Settings shows full per-mint `Item` rows. `Card` remains reserved for balance,
prepared payments, and genuinely grouped security or mint summaries.

### Deployment Origin

The companion is hosted at `wallet.npub.cash` as a dedicated origin and talks
to the npub.cash API across origins. Wallet storage, signer records, CSP, and
future origin-bound credentials belong exclusively to that origin. See
[`docs/adr/0002-host-wallet-on-a-dedicated-origin.md`](../../docs/adr/0002-host-wallet-on-a-dedicated-origin.md).

The API remains available through credential-free CORS to compatible
third-party wallet origins. CORS is not treated as authentication: protected
operations require NIP-98 or JWT authorization and never cookies. Allowed
methods and headers are limited to the API contract, including explicit
exposure of `X-Cashu`.

`wallet.npub.cash` uses a restrictive Content Security Policy with no
third-party runtime scripts, framing, or object embedding. Its network policy
permits the npub.cash API, selected Cashu mints, and NIP-46 relays. It also uses
HSTS, `Referrer-Policy`, `X-Content-Type-Options`, and an explicit Permissions
Policy.

### Telemetry and Diagnostics

The first release sends no third-party analytics, telemetry, or automatic error
reports. It provides no diagnostic export. Runtime logs remain local.

The first release has no general redaction or sanitization subsystem. Code must
nevertheless never deliberately log passphrases, Identity Secrets, Recovery
Phrases, proofs, or encoded ecash tokens. Production uses a restrained log level
because third-party debug objects may contain invoices or other financial data.

### Browser Support

The first release supports current versions of:

- Chrome and Brave on desktop
- Firefox on desktop
- Safari on desktop
- Chrome on Android
- Safari on iOS

Private-browsing use receives a storage-durability warning. Financial-flow CI
runs in Chromium and WebKit; Firefox receives smoke coverage.

### Visual System and Accessibility

The companion retains the existing shadcn Base/Vega preset, purple and mauve
semantic theme, Inter typography, Lucide icons, and light/dark appearance. It is
calm, balance-led, and utilitarian, with generous spacing and minimal
decoration. It avoids a trading-dashboard aesthetic, excessive cards, and
decorative gradients.

The accessibility target is WCAG 2.2 AA: complete keyboard navigation, visible
focus, screen-reader announcements for operation state, reduced-motion support,
sufficient contrast, non-color status cues, and text/copy alternatives for QR
codes.

Shadcn composition rules are normative:

- Forms use `FieldGroup`, `Field`, and the appropriate controls.
- Status and risk callouts use `Alert`; status labels use `Badge`.
- Loading placeholders use `Skeleton` or `Spinner`.
- Empty collections and absent activity use `Empty`.
- Confirmations use `Dialog`, `Drawer`, or `AlertDialog` with an accessible
  title; destructive actions use `AlertDialog`.
- Cards use their full header/content/footer composition and are reserved for
  real grouped surfaces rather than wrapping every section.
- Base UI custom triggers use `render`, not Radix `asChild`.
- Styling uses semantic tokens and built-in variants. Layout uses `gap-*`, and
  icons in buttons use `data-icon` without manual sizing.

The first release installs components only from the official `@shadcn`
registry. A community registry requires a later explicit decision and source
review. The workspace shadcn skill remains mandatory for component additions
and design changes.

The accepted initial component inventory is:

- Shell and display: `button`, `badge`, `item`, `separator`, `dropdown-menu`,
  `tooltip`
- Forms: `field`, `input`, `input-group`, `select`, `toggle-group`
- Surfaces: `card`, `collapsible`
- Overlays: `drawer`, `dialog`, `alert-dialog`
- Feedback: `alert`, `empty`, `skeleton`, `spinner`, `toast`

Repo-native interface components are limited to the responsive application
shell, semantic bottom/top navigation, balance presentation, QR presentation
with a text/copy alternative, and operation-specific compositions built from
the accepted primitives. `sidebar`, `table`, `tabs`, and community navigation
components are not part of the initial inventory and require a later design
reason before installation.

### Screen Composition Inventory

| Screen | Primary composition |
| --- | --- |
| Sign in | `Card`, signer `Button`s, advanced direct-nsec disclosure, security `Alert` |
| NIP-46 pairing | Responsive `Drawer`, QR presentation, connection `Spinner`, actions |
| Wallet initialization | Staged status list, `Spinner`, browser-data-loss `Alert` |
| Wallet | Balance surface, action `Button`s, claim `Alert`, mint `Collapsible` |
| Activity | Date-grouped `Item`s, state `Badge`s, `Empty` |
| Activity detail | Stable route, operation summary, recovery `Alert`, optional quick-view `Drawer` |
| Send ecash | `FieldGroup`, `InputGroup`, review `Card`, responsive confirmation, token QR |
| Pay Lightning | `FieldGroup`, `InputGroup`, review `Card`, responsive confirmation, settlement state |
| Settings | `Item` rows, `Separator`s, focused subroutes |
| Preferred mint | URL `Field`, validated mint summary `Card`, custodial `Alert` |
| Signer settings | Signer `Item`, session state `Badge`, Sign Out action |
| Recovery | Risk `Alert`, confirmation-gated Recovery Phrase reveal |
| Username | Username `Field`, provisional terms `Card`, ambiguity `Alert` |
| Destructive recovery | Titled `AlertDialog` with explicit consequences |

### Release Gates

A release requires:

- Unit tests for signer records, direct-nsec encryption, wallet registry, and
  lifecycle transitions
- Integration tests for Coco/NPC initialization, automatic claim, retry, and
  teardown
- Browser tests for every Nostr Signer mode, identity switching, seed
  invariants, ecash Send/reclaim, Lightning pending/finalized outcomes, and
  Sign Out
- IndexedDB migration fixtures for every dependency-tuple upgrade
- Full financial-flow passes in Chromium and WebKit and Firefox smoke tests
- Frozen-lockfile install, exact peer compatibility, typecheck, lint, and
  production build

Custody, seed selection, duplicate claiming, payment recovery, or database
migration failures block release.

The frontend release is blocked if its own retry behavior can automatically
create a duplicate Username Purchase payment. Server-side paid-but-unassigned
reconciliation remains a separately tracked server concern.

### Implementation Sequence

Implementation is organized as end-to-end vertical slices rather than
architecture layers or a screen-by-screen build. The proposed dependency map,
slice outcomes, UI composition, failure behavior, and exit tests live in
[`IMPLEMENTATION-MAP.md`](./IMPLEMENTATION-MAP.md).

The map starts with one bounded toolchain runway, then proves the full
signer-to-wallet path with NIP-07 before adding direct nsec and NIP-46 as
independent signer slices. Automatic claim, durable claim recovery, ecash,
Lightning, Settings, and Username Purchase follow as browser-demonstrable
financial outcomes. Deployment and cross-browser convergence close the map,
but feature-owned persistence, failure states, accessibility, and tests remain
part of the slice that first needs them.

### Username Fee Policy

For the first release, the server absorbs the Cashu receiver input fee for a
Username Purchase. The Recipient sees and pays one exact configured price. A
future move to different NUT-18 net-fee construction requires an explicit,
tested compatibility change across the server, plugin, and Coco tuple.
