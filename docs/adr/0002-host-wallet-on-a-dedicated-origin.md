---
status: accepted
---

# Host the wallet on a dedicated origin

The Claim Companion is hosted at `wallet.npub.cash` rather than below the
landing-page origin. Browser wallet data, signer credentials, CSP, and future
origin-bound credentials therefore have an isolated runtime boundary; the
wallet calls the npub.cash API across origins. This origin must remain stable
because moving it after recipients hold funds would require an explicit data
migration and could strand Wallet Installations in old browser storage.
