import { describe, expect, test } from "bun:test"

import { filterSafeNpubCashQuotes } from "./npubcash-quote-guard"

const ordinaryQuote = {
  quoteId: "ordinary",
  mintUrl: "https://mint.example",
  amount: 21,
  expiresAt: 1_800_000_000,
  paidAt: 1_700_000_000,
  request: "lnbc21",
  locked: false,
}

describe("npub.cash quote guard", () => {
  test("passes an ordinary paid quote to NPC unchanged", () => {
    expect(filterSafeNpubCashQuotes([ordinaryQuote])).toEqual({
      accepted: [ordinaryQuote],
      issues: [],
      earliestProtectedPaidAt: null,
    })
  })

  test("rejects a protected payment before NPC can import it", () => {
    expect(
      filterSafeNpubCashQuotes([{ ...ordinaryQuote, locked: true }])
    ).toEqual({
      accepted: [],
      earliestProtectedPaidAt: 1_700_000_000,
      issues: [
        {
          kind: "protected-payment",
          title: "Protected payment unsupported",
          message:
            "This payment is protected and cannot be claimed safely by this Wallet version.",
          amount: 21,
          mintUrl: "https://mint.example",
        },
      ],
    })
  })

  test("classifies malformed records without retaining their payload", () => {
    const malformed = { quoteId: "sensitive-server-value", amount: -1 }

    expect(filterSafeNpubCashQuotes([malformed])).toEqual({
      accepted: [],
      issues: [
        {
          kind: "malformed-quote",
          title: "Payment information unavailable",
          message:
            "npub.cash returned payment information this Wallet could not safely process.",
        },
      ],
      earliestProtectedPaidAt: null,
    })
  })

  test("fails closed when the required locked marker is absent", () => {
    const missingLockMarker = {
      quoteId: ordinaryQuote.quoteId,
      mintUrl: ordinaryQuote.mintUrl,
      amount: ordinaryQuote.amount,
      expiresAt: ordinaryQuote.expiresAt,
      paidAt: ordinaryQuote.paidAt,
      request: ordinaryQuote.request,
    }

    expect(filterSafeNpubCashQuotes([missingLockMarker])).toEqual({
      accepted: [],
      issues: [
        {
          kind: "malformed-quote",
          title: "Payment information unavailable",
          message:
            "npub.cash returned payment information this Wallet could not safely process.",
        },
      ],
      earliestProtectedPaidAt: null,
    })
  })

  test("returns the earliest protected cursor without reconstructing identity", () => {
    const later = {
      ...ordinaryQuote,
      quoteId: "later",
      paidAt: 1_700_000_010,
      locked: true,
    }
    const earlier = {
      ...ordinaryQuote,
      quoteId: "earlier",
      paidAt: 1_700_000_005,
      locked: true,
    }

    expect(
      filterSafeNpubCashQuotes([later, earlier]).earliestProtectedPaidAt
    ).toBe(1_700_000_005)
  })
})
