# Signer persistence for the npub.cash Claim Companion

Verified against primary sources on 2026-08-12. This note covers the three
first-release signer modes: directly entered `nsec`, NIP-07, and an
app-initiated NIP-46 `nostrconnect://` connection.

## Conclusions

- Persistence must be modeled per signer mode. NIP-07 is re-discovered on each
  open and has no app-owned credential. Direct `nsec` and NIP-46 each leave the
  app responsible for a secret that must survive a restart.
- Put signer records in a versioned IndexedDB vault separate from Coco's proof
  database. IndexedDB provides durable, transactional, same-origin storage; it
  does not make stored values confidential from JavaScript running on that
  origin. Browser storage can also be cleared or evicted, and private-browsing
  storage is not durable. [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API),
  [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- Encrypt the app-owned secret bytes at rest. A passcode-derived AES-GCM key is
  the broad-compatibility baseline; WebAuthn PRF can be a stronger, optional
  unlock mechanism after runtime verification. A co-resident non-extractable
  WebCrypto key is useful as a device-local convenience key, but is not an
  authentication boundary.
- This signer vault does **not** protect the unencrypted Coco proof database.
  Anyone or any same-origin script able to read those proofs can spend them
  without the Nostr signer. Requiring an active signer to render the wallet is
  therefore a UX/account-selection gate, not encryption or access control.

## What must survive a restart

| Mode | Retain | Do not retain / restoration check |
| --- | --- | --- |
| Direct `nsec` | Signer type, expected user pubkey, and the encrypted 32-byte secret key (plus the encryption-envelope version and parameters) | Do not keep plaintext `nsec` text. On unlock, derive the pubkey again and require it to match the record. |
| NIP-07 | Signer type and expected user pubkey only | The extension owns the key and permissions. On every open, wait for/check `window.nostr`, call `getPublicKey()`, and require the returned pubkey to match. There is no NIP-07 session token or standardized identity-change event to restore. |
| NIP-46 `nostrconnect://` | Signer type; encrypted local **client secret key**; local client pubkey; remote-signer pubkey; actual user pubkey; relay URLs; requested/known permissions; schema/protocol version | Keep the pairing secret only while awaiting the initial response. Validate the returned secret, then erase it. On restore, reconnect to the relays, address the stored remote-signer pubkey, call `get_public_key`, and require the returned user pubkey to match before opening. Treat timeout, revocation, and remote unavailability as recoverable connection states. |

NIP-07 defines only a browser-provided `window.nostr` capability with
`getPublicKey()` and `signEvent()` as its required methods; storage and account
selection remain extension responsibilities. [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md)

NIP-46 deliberately distinguishes three keys: the disposable client keypair,
the remote signer's transport keypair, and the user's actual identity keypair.
The client may store its keypair locally and should delete it on logout. After
connecting it must call `get_public_key` to learn the user pubkey. For a
client-initiated connection, the `nostrconnect://` URI contains the client
pubkey, one or more relays, and a required random secret; the client discovers
the remote-signer pubkey from the response author and must verify the returned
secret to prevent spoofing. [NIP-46 terminology and overview](https://github.com/nostr-protocol/nips/blob/master/46.md#terminology),
[NIP-46 client-initiated connection](https://github.com/nostr-protocol/nips/blob/master/46.md#direct-connection-initiated-by-the-client)

Persisting the entire `nostrconnect://` URI is the wrong abstraction: it omits
the user pubkey learned after pairing and retains a one-time anti-spoofing
secret longer than necessary. Persist the established connection record
instead. If the tab closes before pairing completes, restarting the pairing is
safer and simpler than durably storing a half-established session.

## Slice 3 compatibility audit: `nostr-tools@2.19.4`

Verified against NIP-46 revision
[`f0af204`](https://github.com/nostr-protocol/nips/blob/f0af20484c5e0d12e2d1936f87c5a6681a08daff/46.md)
and the exact `nostr-tools` tag `v2.19.4` on 2026-08-13. The smallest compatible
choice is to keep the pinned dependency and place a narrow, application-owned
session adapter around `nostr-tools/nip46`; adding another Nostr SDK or
upgrading the dependency is not required for this slice.

The pinned package already exports `createNostrConnectURI`, `BunkerSigner`, and
`BunkerPointer`. `BunkerSigner.fromURI()` listens for an app-initiated response,
derives the remote-signer pubkey from the response author, decrypts with the
candidate conversation key, and resolves only when the response result equals
the URI secret. `getPublicKey()` sends `get_public_key` rather than returning
the transport pubkey. Its `onauth` path keeps the original request listener
alive after an `auth_url` response, allowing the required later response with
the same request ID. These are the useful protocol primitives to reuse.
[`nostr-tools@2.19.4` NIP-46 export](https://github.com/nbd-wtf/nostr-tools/blob/v2.19.4/package.json#L161-L170),
[`nostr-tools@2.19.4` NIP-46 implementation](https://github.com/nbd-wtf/nostr-tools/blob/v2.19.4/nip46.ts),
[NIP-46 client-initiated connection](https://github.com/nostr-protocol/nips/blob/f0af20484c5e0d12e2d1936f87c5a6681a08daff/46.md#L50-L67),
[NIP-46 auth challenges](https://github.com/nostr-protocol/nips/blob/f0af20484c5e0d12e2d1936f87c5a6681a08daff/46.md#L211-L223)

`BunkerSigner` is a primitive, not the complete Slice 3 lifecycle. The adapter
must supply the following behavior:

- Generate the client secret key and pairing secret independently. After
  `fromURI()` resolves, copy only `{ pubkey, relays, secret: null }` into the
  established record and drop all application references to the URI/pairing
  secret. Do not persist the signer's public `bp.secret`, because `fromURI()`
  leaves the one-time secret there.
- On restoration, construct a fresh signer with
  `BunkerSigner.fromBunker(clientSecretKey, sanitizedPointer)`, then call
  `getPublicKey()`, require a 64-character lowercase hex pubkey, and compare it
  exactly with the persisted Recipient Public Key before opening any Wallet.
  Validate the same way before initial persistence. A new instance matters
  because `getPublicKey()` caches its first result within an instance without
  validating its shape.
- Give pairing its own `SimplePool`. In 2.19.4, `fromURI()` accepts only a
  numeric `maxWait`, not an `AbortSignal`; Cancel must destroy that dedicated
  pool/subscription, ignore any late resolution, and dispose a signer that wins
  the cancellation race. This also prevents pairing cancellation from closing
  relays used by an established session.
- Put an application timeout around every `sendRequest()`. The pinned method
  has no request timeout, and an auth challenge is expressly allowed never to
  receive its follow-up response. On timeout/cancel, discard the signer and its
  pool rather than reusing a transport with unresolved internal listeners.
- Validate `onauth` input as an allowed HTTP(S) URL before showing or opening
  it. Treat it as progress, not completion; the original operation remains
  pending until the same request ID receives a terminal result or error.
- Call the generic `sendRequest("switch_relays", [])` immediately after pairing
  and at reconnect intervals. Parse the result as JSON, accept only `null` or a
  non-empty array of allowed `wss://` relay URLs, persist an accepted replacement
  atomically, and recreate the signer/subscription on those relays. Merely
  mutating `bp.relays` does not move the subscription that 2.19.4 already
  opened.
- On Sign Out, best-effort `sendRequest("logout", [])` with a short timeout and
  optionally check for `"ack"`; regardless of its outcome, close transport,
  delete the local client key and connection record, and finish local logout.

The last two commands are required lifecycle behavior in the current spec but
have no dedicated methods in 2.19.4; its public generic `sendRequest()` is the
smallest escape hatch. NIP-46 says clients should request `switch_relays`
immediately after connection, and explicitly says remote `logout` is only a
courtesy while deletion of the local client keypair is mandatory.
[NIP-46 methods and relay switching](https://github.com/nostr-protocol/nips/blob/f0af20484c5e0d12e2d1936f87c5a6681a08daff/46.md#L94-L129),
[NIP-46 ending a session](https://github.com/nostr-protocol/nips/blob/f0af20484c5e0d12e2d1936f87c5a6681a08daff/46.md#L131-L135),
[`nostr-tools@2.19.4` request and public-key behavior](https://github.com/nbd-wtf/nostr-tools/blob/v2.19.4/nip46.ts#L352-L419)

No higher-level dependency is justified for this vertical slice. Slice 3 uses
an application-owned kind-24133 session module built from the pinned package's
`createNostrConnectURI`, NIP-44, event-signing, and `SimplePool` primitives,
rather than wrapping `BunkerSigner`. Protocol tests confirmed that the product
needs direct ownership of the pending-request map to reject every request on
cancel/timeout, keep the same request pending across `auth_url`, and migrate
the response subscription before sending on switched relays. `BunkerSigner`
keeps those listeners private, does not reject them from `close()`, and cannot
migrate its private subscription safely. The application module avoids
duplicating cryptography while making cleanup and correlation part of its
narrow tested interface.

## Storage and encryption choices

### Plain IndexedDB or `localStorage`

Both are partitioned by origin, which prevents an unrelated origin from
directly reading the values. That is the extent of the relevant protection:
application JavaScript on the same origin can read them. `localStorage` is a
synchronous string store shared by all same-origin documents and persists
across browser restarts; IndexedDB stores structured-cloneable objects and is
asynchronous and transactional. These properties make IndexedDB the better
engineering fit, not a secret store. [Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#cross-origin_data_storage_access),
[IndexedDB concepts](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API#key_concepts_and_usage),
[Web Storage concepts](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API#concepts_and_usage)

Plain browser storage does not protect an `nsec` or NIP-46 client key from XSS,
a compromised same-origin dependency, a malicious extension with sufficient
access, an unlocked browser profile, or a copied storage database. It also does
not provide backup: quota and eviction behavior varies between browsers, users
can clear site data, and private-mode data is deleted when the private session
ends.

### Passcode-derived WebCrypto key

A portable local envelope can derive an AES-256-GCM key from a user passcode
with PBKDF2, a fresh random salt of at least 16 bytes, a device-calibrated
iteration count, and SHA-256 or stronger. Store the salt, KDF parameters, unique
96-bit AES-GCM IV, ciphertext, and schema version in IndexedDB. AES-GCM
authenticates the ciphertext as well as encrypting it; an IV must never be
reused with the same key. WebCrypto key derivation is available only in a
secure context in supporting browsers. [PBKDF2 parameters](https://developer.mozilla.org/en-US/docs/Web/API/Pbkdf2Params),
[`deriveKey()` and PBKDF2](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey#pbkdf2),
[AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)

This protects against passive storage disclosure only to the strength of the
passcode and KDF cost. A copied ciphertext can be tested offline, so a short
PIN remains guessable; PBKDF2 raises the cost but does not create entropy.
Same-origin malicious code can capture the passcode or plaintext during
unlock. A forgotten passcode cannot be recovered by npub.cash: the user must
enter the `nsec` again or create a new NIP-46 pairing.

### Non-extractable `CryptoKey` in IndexedDB

WebCrypto keys are serializable and are expected to be stored in IndexedDB. If
a key is created/imported with `extractable: false`, `exportKey()` and
`wrapKey()` must reject, so raw key material need not be exposed to JavaScript.
[WebCrypto key storage](https://www.w3.org/TR/webcrypto/#key-storage),
[non-extractable export behavior](https://www.w3.org/TR/webcrypto/#SubtleCrypto-method-exportKey)

Two limits matter here:

1. Nostr uses Schnorr signatures on `secp256k1`, while the standard WebCrypto
   ECDSA curves are P-256, P-384, and P-521. A portable browser implementation
   therefore cannot import an `nsec` or NIP-46 client secret directly as a
   non-extractable signing key. It can instead generate a non-extractable AES
   key and use that key to encrypt the raw Nostr secret. [NIP-01 key curve](https://github.com/nostr-protocol/nips/blob/master/01.md#events-and-signatures),
   [WebCrypto ECDSA key generation](https://www.w3.org/TR/webcrypto/#ecdsa-operations)
2. Non-extractable means "cannot be exported through WebCrypto," not "cannot
   be used." Same-origin code that retrieves the AES key can ask WebCrypto to
   decrypt the Nostr secret. The WebCrypto specification explicitly scopes
   stored keys to the execution environment and origin; it does not promise
   hardware backing. A key stored beside its ciphertext also provides no user
   verification and is lost when that browser profile/site data is lost.
   [WebCrypto security considerations](https://www.w3.org/TR/webcrypto/#security-developers)

This option is appropriate only for an explicitly labeled "remember on this
device" convenience path or to reduce accidental raw-key export. It should not
be described as locking the wallet.

### WebAuthn PRF

The WebAuthn `prf` extension evaluates a credential-associated function and
returns a deterministic 32-byte result for a given input. The specification's
motivating use is a symmetric key that makes encrypted data inaccessible
without an assertion from the associated credential. Authenticators are
responsible for obtaining user consent, and a wallet can request user
verification. [WebAuthn PRF extension](https://www.w3.org/TR/webauthn-3/#sctn-prf-extension),
[WebAuthn security model](https://www.w3.org/TR/webauthn-3/#abstract)

Use the PRF result as key material for an AES-GCM wrapping key, and retain the
credential ID, PRF input, ciphertext envelope, and RP/schema version. This
resists an offline guessing attack against a copied IndexedDB because the
unlock key is not derived from a human password. It still does not stop
same-origin malware from requesting an assertion and deceiving the user into
approving it, or from stealing plaintext after a legitimate unlock.

PRF must be progressive enhancement, not the only compatible path:

- WebAuthn is RP-scoped and requires a stable HTTPS relying-party domain.
- PRF is optional at both the browser/client and authenticator layers. The app
  must inspect `getClientExtensionResults()`—registration may report
  `enabled: false`, and authentication may return no result. Evaluation during
  credential creation is less widely available than during an assertion.
  [MDN WebAuthn PRF behavior](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#prf)
- Current support still varies by browser, OS, and authenticator path. For
  example, Safari added `prf` in Safari 18, while later WebKit work was still
  adding/fixing CTAP `hmac-secret` security-key behavior. Feature detection and
  an actual create/get round trip are more reliable than a browser-version
  allowlist. [Safari 18 WebAuthn changes](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/),
  [WebKit PRF/`hmac-secret` implementation](https://bugs.webkit.org/show_bug.cgi?id=259934)
- The PRF is associated with the credential for that credential's lifetime.
  The WebAuthn specification does not give this application a portable secret
  export or guarantee that a credential provider will synchronize its PRF
  state to another browser/device. Deleting or losing the credential can make
  the envelope undecryptable. Recovery must mean re-entering the `nsec` or
  re-pairing NIP-46, not promising cross-device restoration.

## Recommended first-release design

1. Create one versioned `SignerVault` IndexedDB database separate from the Coco
   databases. Encrypt direct `nsec` bytes with authenticated envelope
   encryption. Per the subsequently accepted product design, persist an
   established NIP-46 client connection key without a local passphrase: it is a
   Signer Connection Secret rather than the Recipient's Identity Secret, and
   the remote signer remains the authorization gate.
2. Offer a passphrase-derived envelope as the supported baseline. Calibrate
   PBKDF2 work per device, store the chosen parameters, rate-limit attempts in
   the UI without claiming that client-side rate limiting prevents offline
   guessing, and encourage a passphrase rather than a numeric PIN.
3. Add WebAuthn PRF as an opt-in stronger unlock after a successful runtime
   capability round trip. Wrap a random data-encryption key so unlock methods
   can be replaced without rewriting the signer record. Do not silently add a
   weaker passcode wrapper as "recovery," because the weakest wrapper determines
   resistance to a copied-database attack.
4. For NIP-07, persist only the expected pubkey. Each open must reacquire the
   extension and compare `getPublicKey()` with that pubkey. Wrong account,
   missing extension, rejected permission, and delayed injection are distinct,
   recoverable UI states.
5. Model NIP-46 as a state machine: `pairing -> connected -> reconnecting ->
   unavailable/revoked -> logged-out`. Persist an established connection only
   after validating its required secret and fetching the actual user pubkey.
   Restoration reconnects relays and revalidates `get_public_key`; logout erases
   the client secret key (and may send the remote `logout` courtesy request).
6. Keep decrypted keys in memory only for the open session, clear references on
   lock/logout, and never log them. This reduces accidental exposure but cannot
   guarantee erasure in a garbage-collected JavaScript runtime.
7. Treat origin integrity as part of custody: use a restrictive CSP, avoid
   third-party runtime scripts, pin/audit dependencies, and keep signer and
   proof access below narrow application-service interfaces. These measures are
   essential because active same-origin compromise bypasses every local vault
   option and can steal the unencrypted Cashu proofs directly.

The resulting product claim should stay modest: **the app encrypts persisted
signer credentials and verifies the selected signer before opening the UI. It
does not encrypt locally held ecash or turn the signer prompt into protection
for the proof database.**
