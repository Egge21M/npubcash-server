import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Event, EventTemplate } from "nostr-tools";
import {
  clearPendingNip46Connection,
  clearStoredNip46Session,
  createNip46EventSigner,
  createPendingNip46Connection,
  endNip46Session,
  getPendingNip46Connection,
  getStoredNip46Session,
  setPendingNip46Connection,
  setStoredNip46Session,
  startNip46Handshake,
  type Nip46Handshake,
  type Nip46Session,
  type PendingNip46Connection,
} from "@/lib/nip46";

type ExtensionConfig = {
  type: "extension";
  pubkey: string;
  signer: (template: EventTemplate) => Promise<Event>;
};

type Nip46Config = {
  type: "nip46";
  pubkey: string;
  signer: (template: EventTemplate) => Promise<Event>;
  session: Nip46Session;
};

type NostrConfig = ExtensionConfig | Nip46Config;

type Nip46ConnectionState =
  | "idle"
  | "preparing"
  | "awaiting"
  | "connected"
  | "error";

export interface AuthContextType {
  nostrConfig: NostrConfig | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  loginWithNip46: (relays?: string[]) => string;
  retryNip46Login: () => void;
  cancelNip46Login: () => void;
  nip46State: Nip46ConnectionState;
  nip46Error: string | null;
  nip46URI: string | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const EXTENSION_CONFIG_KEY = "npc-login";
const DEFAULT_NIP46_RELAYS = [
  "wss://relay.nsec.app",
  "wss://relay.damus.io",
];

function createExtensionSigner() {
  return (template: EventTemplate) => {
    if (!window.nostr) {
      return Promise.reject(new Error("Nostr extension not available"));
    }
    return window.nostr.signEvent(template);
  };
}

function openNip46AuthChallenge(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function createNip46Config(session: Nip46Session): Nip46Config {
  return {
    type: "nip46",
    pubkey: session.userPubkey,
    session,
    signer: createNip46EventSigner(session, {
      onauth: openNip46AuthChallenge,
    }),
  };
}

function getInitialConfig(): NostrConfig | null {
  const extensionPubkey = localStorage.getItem(EXTENSION_CONFIG_KEY);
  if (extensionPubkey) {
    clearPendingNip46Connection();
    return {
      type: "extension",
      pubkey: extensionPubkey,
      signer: createExtensionSigner(),
    };
  }

  const session = getStoredNip46Session();
  return session ? createNip46Config(session) : null;
}

function clearAllStoredAuth() {
  localStorage.removeItem(EXTENSION_CONFIG_KEY);
  clearStoredNip46Session();
  clearPendingNip46Connection();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialConfig] = useState(getInitialConfig);
  const [initialPending] = useState(() =>
    initialConfig ? null : getPendingNip46Connection()
  );
  const [nostrConfig, setNostrConfig] = useState<NostrConfig | null>(
    initialConfig
  );
  const [isLoading, setIsLoading] = useState(false);
  const [nip46State, setNip46State] = useState<Nip46ConnectionState>(
    initialPending ? "preparing" : "idle"
  );
  const [nip46Error, setNip46Error] = useState<string | null>(null);
  const [nip46URI, setNip46URI] = useState<string | null>(
    initialPending?.connectionURI ?? null
  );
  const attemptRef = useRef<{
    id: number;
    handshake: Nip46Handshake | null;
  }>({ id: 0, handshake: null });

  const stopNip46Attempt = useCallback(() => {
    attemptRef.current.id += 1;
    attemptRef.current.handshake?.close();
    attemptRef.current.handshake = null;
  }, []);

  const startNip46Connection = useCallback(
    (pending: PendingNip46Connection) => {
      stopNip46Attempt();
      const attemptId = attemptRef.current.id;
      const handshake = startNip46Handshake(pending, {
        onauth: openNip46AuthChallenge,
      });
      attemptRef.current.handshake = handshake;
      setNip46State("preparing");
      setNip46Error(null);
      setNip46URI(pending.connectionURI);

      const isCurrent = () => attemptRef.current.id === attemptId;
      void (async () => {
        try {
          await handshake.ready;
          if (!isCurrent()) return;
          setNip46State("awaiting");

          const session = await handshake.connected;
          if (!isCurrent()) return;

          setStoredNip46Session(session);
          clearPendingNip46Connection();
          attemptRef.current.handshake = null;
          setNostrConfig(createNip46Config(session));
          setNip46URI(null);
          setNip46State("connected");
          setNip46Error(null);
        } catch (error) {
          if (!isCurrent()) return;
          attemptRef.current.handshake = null;
          const stillPending = getPendingNip46Connection();
          if (!stillPending) setNip46URI(null);
          setNip46State("error");
          setNip46Error(
            error instanceof Error ? error.message : "Connection failed"
          );
          console.error("NIP-46 login failed:", error);
        }
      })();
    },
    [stopNip46Attempt]
  );

  useEffect(() => {
    if (initialPending) startNip46Connection(initialPending);
  }, [initialPending, startNip46Connection]);

  // Mobile browsers commonly suspend or discard WebSockets when backgrounded.
  // Recreate the listener from persisted handshake data whenever the page becomes
  // usable again. Reusing the same client key and secret makes this idempotent,
  // and relay-stored kind 24133 responses can be received after the app switch.
  useEffect(() => {
    const resumePendingHandshake = () => {
      if (document.visibilityState === "hidden") return;
      const pending = getPendingNip46Connection();
      if (pending) startNip46Connection(pending);
    };

    document.addEventListener("visibilitychange", resumePendingHandshake);
    window.addEventListener("online", resumePendingHandshake);
    window.addEventListener("pageshow", resumePendingHandshake);
    return () => {
      document.removeEventListener("visibilitychange", resumePendingHandshake);
      window.removeEventListener("online", resumePendingHandshake);
      window.removeEventListener("pageshow", resumePendingHandshake);
    };
  }, [startNip46Connection]);

  useEffect(() => stopNip46Attempt, [stopNip46Attempt]);

  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.nostr) throw new Error("Nostr extension not available");
      const pubkey = await window.nostr.getPublicKey();
      stopNip46Attempt();
      clearAllStoredAuth();
      localStorage.setItem(EXTENSION_CONFIG_KEY, pubkey);
      setNostrConfig({
        type: "extension",
        pubkey,
        signer: createExtensionSigner(),
      });
      setNip46URI(null);
      setNip46State("idle");
      setNip46Error(null);
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [stopNip46Attempt]);

  const loginWithNip46 = useCallback(
    (relays: string[] = DEFAULT_NIP46_RELAYS) => {
      const pending = createPendingNip46Connection({
        relays,
        name: "npub.cash",
        url: window.location.origin,
      });
      localStorage.removeItem(EXTENSION_CONFIG_KEY);
      clearStoredNip46Session();
      setPendingNip46Connection(pending);
      startNip46Connection(pending);
      return pending.connectionURI;
    },
    [startNip46Connection]
  );

  const retryNip46Login = useCallback(() => {
    const pending = getPendingNip46Connection();
    if (!pending) {
      setNip46URI(null);
      setNip46State("error");
      setNip46Error("Connection request expired. Start a new remote signer login.");
      return;
    }
    startNip46Connection(pending);
  }, [startNip46Connection]);

  const cancelNip46Login = useCallback(() => {
    stopNip46Attempt();
    clearPendingNip46Connection();
    setNip46URI(null);
    setNip46State("idle");
    setNip46Error(null);
  }, [stopNip46Attempt]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      stopNip46Attempt();
      if (nostrConfig?.type === "nip46") {
        await endNip46Session(nostrConfig.session);
      }
      clearAllStoredAuth();
      setNostrConfig(null);
      setNip46URI(null);
      setNip46State("idle");
      setNip46Error(null);
    } finally {
      setIsLoading(false);
    }
  }, [nostrConfig, stopNip46Attempt]);

  return (
    <AuthContext.Provider
      value={{
        nostrConfig,
        isAuthenticated: nostrConfig !== null,
        isLoading,
        login,
        loginWithNip46,
        retryNip46Login,
        cancelNip46Login,
        nip46State,
        nip46Error,
        nip46URI,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
