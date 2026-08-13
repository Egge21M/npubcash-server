const INITIAL_UNLOCK_DELAY_MS = 1_000
const MAXIMUM_UNLOCK_DELAY_MS = 30_000

export function nextUnlockRetryAt(
  failedAttempts: number,
  now = Date.now()
): number {
  const exponent = Math.max(0, Math.floor(failedAttempts) - 1)
  const delay = Math.min(
    MAXIMUM_UNLOCK_DELAY_MS,
    INITIAL_UNLOCK_DELAY_MS * 2 ** Math.min(exponent, 30)
  )
  return now + delay
}

export function secondsUntilUnlock(retryAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((retryAt - now) / 1_000))
}
