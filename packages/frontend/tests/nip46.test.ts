import { describe, expect, test } from "bun:test";
import { getPublicKey } from "nostr-tools";
import {
  createNostrConnectURI,
  parseNostrConnectURI,
} from "nostr-tools/nip46";
import { hexToBytes } from "nostr-tools/utils";
import {
  NIP46_HANDSHAKE_TTL_MS,
  createPendingNip46Connection,
  getPendingNip46TimeRemaining,
  parseNip46Session,
  parsePendingNip46Connection,
  parseRelaySwitchResult,
} from "../src/lib/nip46";

const now = 1_800_000_000_000;
const clientSecretKey = "01".repeat(32);
const clientPubkey = getPublicKey(hexToBytes(clientSecretKey));
const remoteSignerPubkey = "02".repeat(32);
const userPubkey = "03".repeat(32);
const connectionURI = createNostrConnectURI({
  clientPubkey,
  relays: ["wss://relay.example"],
  secret: "anti-spoofing-secret",
  perms: ["sign_event"],
  name: "npub.cash",
});
const validPending = {
  clientSecretKey,
  connectionURI,
  createdAt: now - 1_000,
};

describe("pending NIP-46 connection storage", () => {
  test("creates a spec-compliant client-initiated URI", () => {
    const pending = createPendingNip46Connection({
      relays: ["wss://relay.example"],
      name: "npub.cash",
      url: "https://npub.cash",
    });
    const parsed = parseNostrConnectURI(pending.connectionURI);

    expect(parsed.clientPubkey).toBe(
      getPublicKey(hexToBytes(pending.clientSecretKey))
    );
    expect(parsed.params.relays).toEqual(["wss://relay.example"]);
    expect(parsed.params.secret).toHaveLength(64);
    expect(parsed.params.perms).toEqual(["sign_event"]);
    expect(parsed.params.name).toBe("npub.cash");
    expect(parsed.params.url).toBe("https://npub.cash");
  });

  test("restores a valid resumable handshake", () => {
    expect(
      parsePendingNip46Connection(JSON.stringify(validPending), now)
    ).toEqual(validPending);
  });

  test("rejects malformed, spoofable, and expired handshakes", () => {
    expect(parsePendingNip46Connection("not json", now)).toBeNull();
    expect(
      parsePendingNip46Connection(
        JSON.stringify({ ...validPending, clientSecretKey: "04".repeat(32) }),
        now
      )
    ).toBeNull();
    expect(
      parsePendingNip46Connection(
        JSON.stringify({
          ...validPending,
          createdAt: now - NIP46_HANDSHAKE_TTL_MS,
        }),
        now
      )
    ).toBeNull();
  });

  test("calculates the remaining handshake lifetime", () => {
    expect(getPendingNip46TimeRemaining(validPending, now)).toBe(
      NIP46_HANDSHAKE_TTL_MS - 1_000
    );
  });
});

describe("completed NIP-46 session storage", () => {
  test("validates the current representation", () => {
    const session = {
      version: 1 as const,
      clientSecretKey,
      remoteSignerPubkey,
      relays: ["wss://relay.example"],
      userPubkey,
    };
    expect(parseNip46Session(JSON.stringify(session))).toEqual(session);
  });

  test("migrates the previous bunker pointer representation", () => {
    expect(
      parseNip46Session(
        JSON.stringify({
          clientSecretKey,
          bunkerPointer: {
            pubkey: remoteSignerPubkey,
            relays: ["wss://relay.example"],
            secret: "one-time-secret",
          },
          userPubkey,
        })
      )
    ).toEqual({
      version: 1,
      clientSecretKey,
      remoteSignerPubkey,
      relays: ["wss://relay.example"],
      userPubkey,
    });
  });

  test("keeps the remote-signer key distinct from the user key", () => {
    const session = parseNip46Session(
      JSON.stringify({
        version: 1,
        clientSecretKey,
        remoteSignerPubkey,
        relays: ["wss://relay.example"],
        userPubkey,
      })
    );
    expect(session?.remoteSignerPubkey).not.toBe(session?.userPubkey);
  });
});

describe("switch_relays responses", () => {
  test("accepts a valid relay replacement and null", () => {
    expect(
      parseRelaySwitchResult(
        JSON.stringify(["wss://one.example", "wss://two.example"])
      )
    ).toEqual(["wss://one.example", "wss://two.example"]);
    expect(parseRelaySwitchResult("null")).toBeNull();
  });

  test("rejects malformed or insecure relay replacements", () => {
    expect(parseRelaySwitchResult("not json")).toBeNull();
    expect(
      parseRelaySwitchResult(JSON.stringify(["https://relay.example"]))
    ).toBeNull();
  });
});
