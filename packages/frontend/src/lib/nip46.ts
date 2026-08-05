import {
  type Event,
  type EventTemplate,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools";
import {
  BunkerSigner,
  createNostrConnectURI,
  parseNostrConnectURI,
  type BunkerPointer,
} from "nostr-tools/nip46";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

const NIP46_SESSION_KEY = "npc-nip46";
const NIP46_PENDING_KEY = "npc-nip46-pending";
const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

export const NIP46_HANDSHAKE_TTL_MS = 10 * 60 * 1000;
const NIP46_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const NIP46_SETUP_REQUEST_TIMEOUT_MS = 60 * 1000;
const NIP46_RELAY_SWITCH_TIMEOUT_MS = 8 * 1000;

export type PendingNip46Connection = {
  clientSecretKey: string;
  connectionURI: string;
  createdAt: number;
};

export type Nip46Session = {
  version: 1;
  clientSecretKey: string;
  remoteSignerPubkey: string;
  relays: string[];
  userPubkey: string;
};

type LegacyNip46Session = {
  clientSecretKey?: unknown;
  bunkerPointer?: Partial<BunkerPointer>;
  userPubkey?: unknown;
};

export type Nip46Handshake = {
  ready: Promise<void>;
  connected: Promise<Nip46Session>;
  close: () => void;
};

type Nip46Callbacks = {
  onauth?: (url: string) => void;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isHexPubkey(value: unknown): value is string {
  return typeof value === "string" && HEX_PUBKEY.test(value);
}

function parseRelays(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const relays = value.filter((relay): relay is string => {
    if (typeof relay !== "string") return false;
    try {
      const protocol = new URL(relay).protocol;
      return protocol === "wss:" || protocol === "ws:";
    } catch {
      return false;
    }
  });

  if (relays.length !== value.length) return null;
  return [...new Set(relays)];
}

function clientPubkeyMatchesURI(clientSecretKey: string, connectionURI: string) {
  try {
    const parsed = parseNostrConnectURI(connectionURI);
    return getPublicKey(hexToBytes(clientSecretKey)) === parsed.clientPubkey;
  } catch {
    return false;
  }
}

export function parsePendingNip46Connection(
  value: string | null,
  now = Date.now()
): PendingNip46Connection | null {
  if (!value) return null;

  try {
    const pending = JSON.parse(value) as Partial<PendingNip46Connection>;
    if (
      !isHexPubkey(pending.clientSecretKey) ||
      typeof pending.connectionURI !== "string" ||
      typeof pending.createdAt !== "number" ||
      !Number.isFinite(pending.createdAt) ||
      pending.createdAt > now + 60_000 ||
      now - pending.createdAt >= NIP46_HANDSHAKE_TTL_MS ||
      !clientPubkeyMatchesURI(
        pending.clientSecretKey,
        pending.connectionURI
      )
    ) {
      return null;
    }

    const { params } = parseNostrConnectURI(pending.connectionURI);
    if (!parseRelays(params.relays) || !params.secret) return null;

    return pending as PendingNip46Connection;
  } catch {
    return null;
  }
}

export function getPendingNip46Connection(): PendingNip46Connection | null {
  const stored = localStorage.getItem(NIP46_PENDING_KEY);
  const pending = parsePendingNip46Connection(stored);
  if (stored && !pending) localStorage.removeItem(NIP46_PENDING_KEY);
  return pending;
}

export function setPendingNip46Connection(
  pending: PendingNip46Connection
) {
  localStorage.setItem(NIP46_PENDING_KEY, JSON.stringify(pending));
}

export function clearPendingNip46Connection() {
  localStorage.removeItem(NIP46_PENDING_KEY);
}

export function getPendingNip46TimeRemaining(
  pending: PendingNip46Connection,
  now = Date.now()
) {
  return Math.max(0, NIP46_HANDSHAKE_TTL_MS - (now - pending.createdAt));
}

export function createPendingNip46Connection({
  relays,
  name,
  url,
}: {
  relays: string[];
  name: string;
  url?: string;
}): PendingNip46Connection {
  const validRelays = parseRelays(relays);
  if (!validRelays) throw new Error("At least one valid NIP-46 relay is required");

  const clientSecretKey = generateSecretKey();
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const connectionURI = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecretKey),
    relays: validRelays,
    secret,
    name,
    url,
    perms: ["sign_event"],
  });

  return {
    clientSecretKey: bytesToHex(clientSecretKey),
    connectionURI,
    createdAt: Date.now(),
  };
}

export function parseNip46Session(value: string | null): Nip46Session | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<Nip46Session> &
      LegacyNip46Session;
    const clientSecretKey = parsed.clientSecretKey;
    const remoteSignerPubkey =
      parsed.version === 1
        ? parsed.remoteSignerPubkey
        : parsed.bunkerPointer?.pubkey;
    const relays =
      parsed.version === 1 ? parsed.relays : parsed.bunkerPointer?.relays;

    if (
      !isHexPubkey(clientSecretKey) ||
      !isHexPubkey(remoteSignerPubkey) ||
      !isHexPubkey(parsed.userPubkey)
    ) {
      return null;
    }

    const validRelays = parseRelays(relays);
    if (!validRelays) return null;

    // Validate the private client key by deriving its public key. Invalid scalar
    // values throw here instead of leaving a broken session in storage.
    getPublicKey(hexToBytes(clientSecretKey));

    return {
      version: 1,
      clientSecretKey,
      remoteSignerPubkey,
      relays: validRelays,
      userPubkey: parsed.userPubkey,
    };
  } catch {
    return null;
  }
}

export function getStoredNip46Session(): Nip46Session | null {
  const stored = localStorage.getItem(NIP46_SESSION_KEY);
  const session = parseNip46Session(stored);
  if (stored && !session) {
    localStorage.removeItem(NIP46_SESSION_KEY);
  } else if (session && stored !== JSON.stringify(session)) {
    // Transparently migrate the legacy bunkerPointer representation.
    setStoredNip46Session(session);
  }
  return session;
}

export function setStoredNip46Session(session: Nip46Session) {
  localStorage.setItem(NIP46_SESSION_KEY, JSON.stringify(session));
}

export function clearStoredNip46Session() {
  localStorage.removeItem(NIP46_SESSION_KEY);
}

export function parseRelaySwitchResult(result: string): string[] | null {
  if (result === "null") return null;
  try {
    return parseRelays(JSON.parse(result));
  } catch {
    return null;
  }
}

async function connectAtLeastOneRelay(pool: SimplePool, relays: string[]) {
  try {
    await Promise.any(relays.map((relay) => pool.ensureRelay(relay)));
  } catch {
    throw new Error("Could not connect to any NIP-46 relay");
  }
}

export function startNip46Handshake(
  pending: PendingNip46Connection,
  callbacks: Nip46Callbacks = {}
): Nip46Handshake {
  const remaining = getPendingNip46TimeRemaining(pending);
  if (remaining === 0) {
    const expired = Promise.reject<Nip46Session>(
      new Error("Connection request expired. Start a new remote signer login.")
    );
    void expired.catch(() => undefined);
    return { ready: expired.then(() => undefined), connected: expired, close() {} };
  }

  const clientSecretKey = hexToBytes(pending.clientSecretKey);
  const { params } = parseNostrConnectURI(pending.connectionURI);
  const pool = new SimplePool({ enableReconnect: true });
  let signer: BunkerSigner | null = null;
  let closed = false;

  const ready = connectAtLeastOneRelay(pool, params.relays);
  const connected = (async () => {
    await ready;
    if (closed) throw new Error("Connection attempt cancelled");

    signer = await BunkerSigner.fromURI(
      clientSecretKey,
      pending.connectionURI,
      { pool, onauth: callbacks.onauth },
      getPendingNip46TimeRemaining(pending)
    );
    if (closed) throw new Error("Connection attempt cancelled");

    // NIP-46 requires the user key to be requested after connect; the response
    // author is the remote-signer key and is deliberately stored separately.
    const userPubkey = await withTimeout(
      signer.getPublicKey(),
      NIP46_SETUP_REQUEST_TIMEOUT_MS,
      "Remote signer connected but did not provide the user public key"
    );
    if (!isHexPubkey(userPubkey)) {
      throw new Error("Remote signer returned an invalid user public key");
    }

    let relays = [...signer.bp.relays];
    try {
      const switchResult = await withTimeout(
        signer.sendRequest("switch_relays", []),
        NIP46_RELAY_SWITCH_TIMEOUT_MS,
        "Remote signer did not answer switch_relays"
      );
      relays = parseRelaySwitchResult(switchResult) ?? relays;
    } catch (error) {
      // The request is required for compliant clients. Older signers may not
      // implement it, so retain the negotiated relays rather than discarding an
      // otherwise valid session.
      console.warn("NIP-46 switch_relays was not available:", error);
    }

    return {
      version: 1,
      clientSecretKey: pending.clientSecretKey,
      remoteSignerPubkey: signer.bp.pubkey,
      relays,
      userPubkey,
    } satisfies Nip46Session;
  })().finally(async () => {
    if (signer) await signer.close().catch(() => undefined);
    pool.destroy();
  });
  // `ready` and `connected` are consumed at different stages by the UI. Attach a
  // rejection handler immediately so a relay setup failure cannot become an
  // unhandled rejection before the UI advances to awaiting `connected`.
  void connected.catch(() => undefined);

  return {
    ready,
    connected,
    close() {
      closed = true;
      if (signer) void signer.close().catch(() => undefined);
      pool.destroy();
    },
  };
}

function bunkerPointer(session: Nip46Session): BunkerPointer {
  return {
    pubkey: session.remoteSignerPubkey,
    relays: session.relays,
    secret: null,
  };
}

async function withNip46Signer<T>(
  session: Nip46Session,
  operation: (signer: BunkerSigner) => Promise<T>,
  callbacks: Nip46Callbacks = {},
  timeoutMs = NIP46_REQUEST_TIMEOUT_MS
): Promise<T> {
  const pool = new SimplePool({ enableReconnect: true });
  const signer = BunkerSigner.fromBunker(
    hexToBytes(session.clientSecretKey),
    bunkerPointer(session),
    { pool, onauth: callbacks.onauth }
  );

  try {
    await connectAtLeastOneRelay(pool, session.relays);
    return await withTimeout(
      operation(signer),
      timeoutMs,
      "Remote signer request timed out"
    );
  } finally {
    await signer.close().catch(() => undefined);
    pool.destroy();
  }
}

export function createNip46EventSigner(
  session: Nip46Session,
  callbacks: Nip46Callbacks = {}
): (template: EventTemplate) => Promise<Event> {
  return async (template) => {
    const event = await withNip46Signer(
      session,
      (signer) => signer.signEvent(template),
      callbacks
    );
    if (event.pubkey !== session.userPubkey) {
      throw new Error("Remote signer signed with an unexpected user key");
    }
    return event;
  };
}

export async function endNip46Session(session: Nip46Session) {
  try {
    await withNip46Signer(
      session,
      (signer) => signer.sendRequest("logout", []),
      {},
      5_000
    );
  } catch {
    // NIP-46 defines logout as a courtesy hint. Local key deletion is the
    // security boundary and must not depend on the signer being reachable.
  }
}
