---
status: accepted
---

# Pin Coco v2 RC and the NPC nightly as one compatibility tuple

The Claim Companion deliberately uses the Coco v2 release-candidate line and
the nightly npub.cash plugin because that is where the required integration is
being developed, and the team controls both projects. These packages contain
exact peer coupling and moving distribution tags can point to incompatible
builds, so the wallet pins every member of the tuple to an exact version,
commits the lockfile, and upgrades the tuple atomically only after browser
compatibility tests pass.
