import { describe, expect, test } from "bun:test"

import { nextUnlockRetryAt, secondsUntilUnlock } from "./unlock-rate-limit"

describe("direct signer unlock rate limit", () => {
  test("backs off repeated failures with a bounded delay", () => {
    expect(nextUnlockRetryAt(1, 10_000)).toBe(11_000)
    expect(nextUnlockRetryAt(2, 10_000)).toBe(12_000)
    expect(nextUnlockRetryAt(20, 10_000)).toBe(40_000)
  })

  test("reports whole seconds until another attempt is allowed", () => {
    expect(secondsUntilUnlock(12_001, 10_000)).toBe(3)
    expect(secondsUntilUnlock(10_000, 10_000)).toBe(0)
  })
})
