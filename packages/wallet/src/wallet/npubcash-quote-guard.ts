import type { SinceStore } from "coco-cashu-plugin-npc"

interface NpubCashQuoteFields {
  quoteId: string
  mintUrl: string
  amount: number
  expiresAt: number
  paidAt: number
  request?: string
  [key: string]: unknown
}

export interface SafeNpubCashQuote extends NpubCashQuoteFields {
  locked: false
}

interface ValidNpubCashQuote extends NpubCashQuoteFields {
  locked: boolean
}

export type NpubCashQuoteIssue =
  | {
      kind: "protected-payment"
      title: "Protected payment unsupported"
      message: string
      amount: number
      mintUrl: string
    }
  | {
      kind: "malformed-quote"
      title: "Payment information unavailable"
      message: string
    }

export interface SafeQuoteFilterResult {
  accepted: SafeNpubCashQuote[]
  issues: NpubCashQuoteIssue[]
  earliestProtectedPaidAt: number | null
}

export class GuardedNpubCashSinceStore implements SinceStore {
  private blockedAt: number | null = null
  private readonly store: SinceStore

  constructor(store: SinceStore) {
    this.store = store
  }

  blockAt(paidAt: number): void {
    this.blockedAt =
      this.blockedAt === null ? paidAt : Math.min(this.blockedAt, paidAt)
  }

  get(): Promise<number> {
    return this.store.get()
  }

  set(since: number): Promise<void> {
    const safeSince =
      this.blockedAt === null
        ? since
        : Math.min(since, Math.max(0, this.blockedAt - 1))
    return this.store.set(safeSince)
  }
}

function isSafeMintUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    )
  } catch {
    return false
  }
}

function isSafeQuote(value: unknown): value is ValidNpubCashQuote {
  if (!value || typeof value !== "object") return false
  const quote = value as Record<string, unknown>
  return (
    typeof quote.quoteId === "string" &&
    quote.quoteId.length > 0 &&
    isSafeMintUrl(quote.mintUrl) &&
    typeof quote.amount === "number" &&
    Number.isSafeInteger(quote.amount) &&
    quote.amount > 0 &&
    typeof quote.expiresAt === "number" &&
    Number.isFinite(quote.expiresAt) &&
    typeof quote.paidAt === "number" &&
    Number.isFinite(quote.paidAt) &&
    (quote.request === undefined || typeof quote.request === "string") &&
    typeof quote.locked === "boolean"
  )
}

export function filterSafeNpubCashQuotes(
  values: unknown[]
): SafeQuoteFilterResult {
  const accepted: SafeNpubCashQuote[] = []
  const issues: NpubCashQuoteIssue[] = []
  let earliestProtectedPaidAt: number | null = null

  for (const value of values) {
    if (!isSafeQuote(value)) {
      issues.push({
        kind: "malformed-quote",
        title: "Payment information unavailable",
        message:
          "npub.cash returned payment information this Wallet could not safely process.",
      })
      continue
    }
    if (value.locked === true) {
      earliestProtectedPaidAt =
        earliestProtectedPaidAt === null
          ? value.paidAt
          : Math.min(earliestProtectedPaidAt, value.paidAt)
      issues.push({
        kind: "protected-payment",
        title: "Protected payment unsupported",
        message:
          "This payment is protected and cannot be claimed safely by this Wallet version.",
        amount: value.amount,
        mintUrl: value.mintUrl,
      })
      continue
    }
    accepted.push(value as SafeNpubCashQuote)
  }

  return { accepted, issues, earliestProtectedPaidAt }
}
