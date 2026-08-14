# npub.cash Wallet

The Claim Companion is a React 19, TypeScript, Vite, Tailwind CSS v4, and
shadcn/ui application. Its browser storage belongs to the dedicated
`wallet.npub.cash` origin.

## Run from the repository root

```bash
bun install --frozen-lockfile
bun run wallet:dev
bun run wallet:typecheck
bun run wallet:lint
bun run wallet:test
bun run wallet:test:browser
bun run wallet:build
```

The Coco RC and npub.cash plugin versions are an exact compatibility tuple.
Update them together according to `docs/adr/0001-pin-coco-v2-rc-and-npc-nightly.md`.

## Browser environment

Copy `.env.example` to `.env.local` when overriding local defaults.

- `VITE_NPUBCASH_API_ORIGIN` is the public HTTPS npub.cash API origin. HTTP is
  accepted only for localhost development.
- `VITE_NIP46_RELAYS` is a comma-separated list of secure `wss://` relay URLs
  used to initiate NIP-46 remote-signer connections.

Secrets, signer credentials, Recovery Phrases, proofs, and encoded tokens must
never be placed in Vite environment variables.

## shadcn/ui

Use the repository's shadcn skill and Bun runner before adding or using an
official component:

```bash
bunx --bun shadcn@latest info --json
bunx --bun shadcn@latest docs button
bunx --bun shadcn@latest add @shadcn/button
```
