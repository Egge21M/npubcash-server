export interface WalletEnvironment {
  apiOrigin: string
  nip46Relays: string[]
}

type EnvironmentSource = Record<string, string | undefined>

function parseUrl(value: string, field: string, protocols: string[]): URL {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${field} must be an absolute URL`)
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${field} must use ${protocols.join(" or ")}`)
  }

  return parsed
}

export function parseWalletEnvironment(
  source: EnvironmentSource
): WalletEnvironment {
  const apiUrl = parseUrl(
    source.VITE_NPUBCASH_API_ORIGIN ?? "https://npub.cash",
    "VITE_NPUBCASH_API_ORIGIN",
    ["https:", "http:"]
  )

  if (apiUrl.protocol === "http:" && apiUrl.hostname !== "localhost") {
    throw new Error("VITE_NPUBCASH_API_ORIGIN must use HTTPS outside localhost")
  }

  const nip46Relays = (source.VITE_NIP46_RELAYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) =>
      parseUrl(value, `VITE_NIP46_RELAYS[${index}]`, ["wss:"]).toString()
    )

  return {
    apiOrigin: apiUrl.origin,
    nip46Relays,
  }
}

export const walletEnvironment = parseWalletEnvironment(import.meta.env)
