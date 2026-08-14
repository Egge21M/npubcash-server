export class InvalidNip46RelayError extends Error {
  readonly reason: "invalid" | "insecure"

  constructor(reason: "invalid" | "insecure") {
    super(
      reason === "invalid"
        ? "The relay URL is invalid."
        : "The relay URL must use WSS."
    )
    this.name = "InvalidNip46RelayError"
    this.reason = reason
  }
}

export function normalizeNip46Relay(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InvalidNip46RelayError("invalid")
  }
  if (url.protocol !== "wss:") {
    throw new InvalidNip46RelayError("insecure")
  }
  return url.toString()
}
