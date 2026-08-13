# npub.cash Server

The npub.cash server enables Nostr identities to receive payments through LNURL and manage the resulting wallet funds.

## Language

**Recipient**:
A Nostr identity that can receive payments through the server's LNURL interface.
_Avoid_: User, account

**Recipient Address**:
An npub or claimed username through which an LNURL request identifies a Recipient.

**Recipient Username**:
An optional human-readable name claimed by a Recipient and used as a Recipient Address.
_Avoid_: Account name, login

**Unavailable Recipient Address**:
A Recipient Address for which the server will not offer LNURL payment discovery, either because it is unknown or because its Public Key has an LNURL Recipient Block.
_Avoid_: User not found, blacklisted user

**LNURL Recipient Block**:
The prospective exclusion of a Recipient from LNURL discovery and from obtaining new payment requests. It neither invalidates previously issued invoices nor suspends that identity from other server capabilities.
_Avoid_: Blacklist, blacklisted user, banned user

**Public Key**:
The canonical Nostr identity of a Recipient, independent of how that identity is presented or addressed.
_Avoid_: npub, username

**npub**:
A human-readable encoding of a Public Key. It represents an identity but is not itself the canonical identity.

## Claim Companion

**Claim Companion**:
A client-side wallet focused on discovering and claiming payments received through npub.cash, then moving the resulting value out through a limited set of send operations.
_Avoid_: General-purpose wallet, account

**Wallet Material**:
The secrets and bearer proofs that provide control over ecash held by the Claim Companion.
_Avoid_: Account data, login data

**Nostr Signer**:
The capability authorized by a Recipient to sign Nostr events, whether provided by a local key, browser extension, or remote signer.
_Avoid_: Login provider, account

**Identity Secret**:
The private Nostr key that directly controls a Recipient's Public Key and can authorize operations without another signer.
_Avoid_: Connection secret, login token

**Signer Connection Secret**:
A client-side credential that authorizes a Signer Session with a remote Nostr Signer but does not itself control the Recipient's Public Key.
_Avoid_: Identity Secret, nsec

**Signer Session**:
The locally retained information needed to restore access to a previously authorized Nostr Signer without silently changing the Recipient's Public Key.
_Avoid_: Login data, account session

**Wallet**:
The Claim Companion's locally held Wallet Material and payment history associated with exactly one Recipient Public Key.
_Avoid_: Account, shared wallet

**Wallet Installation**:
A Wallet's local data and random seed within one browser storage partition. Separate devices or browser profiles may contain independent Wallet Installations for the same Public Key.
_Avoid_: Synced wallet, account

**Recovery Phrase**:
The 12-word BIP-39 mnemonic from which one Wallet Installation's Coco seed is derived. It does not restore the Nostr Signer, application history, or Signer Session.
_Avoid_: Nostr seed, nsec, password

**Pending Payment**:
A paid npub.cash mint quote from which the Wallet has not yet obtained and persisted spendable proofs.
_Avoid_: Balance, pending transaction

**Claim**:
The operation that obtains proofs from a Pending Payment's mint quote and persists them as spendable Wallet Material.
_Avoid_: Redeem, receive, mint

**Send**:
An operation that moves spendable value out of the Wallet as Cashu ecash, Lightning, or on-chain Bitcoin.
_Avoid_: Claim, redeem

**Mint Balance**:
The Wallet's spendable value held as proofs issued by one trusted Cashu mint.
_Avoid_: Account balance

**Sign Out**:
The operation that closes the Wallet interface and forgets its Signer Session while retaining the Wallet Installation.
_Avoid_: Delete wallet, remove funds

**Username Purchase**:
The durable operation that pays for and assigns a Recipient Username to the authenticated Recipient.
_Avoid_: Registration, account creation
