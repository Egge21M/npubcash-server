# npub.cash

npub.cash connects Nostr identities with Cashu payments and exposes a user's payment history.

## Language

**Mint Identity**:
The canonical URL that identifies a Cashu mint, ignoring cosmetic differences in scheme or host casing, trailing slashes, and duplicate path slashes.
_Avoid_: Raw mint URL, mint spelling

**Mint Allowlist**:
A user-supplied set of Cashu mints that restricts a quote history result to quotes from those mints.
_Avoid_: Mint blocklist, mint exclusion list

**Quote Update Notification**:
A signal that a quote became paid and claimable after a client connected, prompting the client to refresh its quote history.
_Avoid_: New quote notification, quote history
