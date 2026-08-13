import { expect, test, type Page } from "@playwright/test"

const PUBLIC_KEY_A = "a".repeat(64)
const PUBLIC_KEY_B = "b".repeat(64)

async function installNip07(page: Page, publicKey = PUBLIC_KEY_A) {
  await page.addInitScript((initialPublicKey) => {
    if (!localStorage.getItem("npubcash-test-public-key")) {
      localStorage.setItem("npubcash-test-public-key", initialPublicKey)
    }
    Object.defineProperty(window, "nostr", {
      configurable: true,
      value: {
        getPublicKey: async () =>
          localStorage.getItem("npubcash-test-public-key"),
        signEvent: async (event: Record<string, unknown>) => ({
          ...event,
          pubkey: localStorage.getItem("npubcash-test-public-key"),
          id: "0".repeat(64),
          sig: "0".repeat(128),
        }),
      },
    })
  }, publicKey)
}

async function signIn(page: Page) {
  await page.goto("/")
  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
}

async function finishOpening(page: Page) {
  const openWallet = page.getByRole("button", { name: "Open Wallet" })
  await expect(
    openWallet.or(page.getByText("0 sat", { exact: true }))
  ).toBeVisible()
  if (await openWallet.isVisible()) {
    await expect(
      page.getByText("This Wallet exists only in this browser")
    ).toBeVisible()
    await openWallet.click()
  }
}

async function readInstallation(page: Page, publicKey = PUBLIC_KEY_A) {
  return page.evaluate(async (key) => {
    const request = indexedDB.open("npubcash-wallet-registry")
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction("installations", "readonly")
    const recordRequest = transaction.objectStore("installations").get(key)
    const record = await new Promise<{
      recoveryPhrase: string
      databaseName: string
    }>((resolve, reject) => {
      recordRequest.onsuccess = () => resolve(recordRequest.result)
      recordRequest.onerror = () => reject(recordRequest.error)
    })
    database.close()
    return record
  }, publicKey)
}

async function deleteDatabase(page: Page, name: string) {
  return page.evaluate(async (databaseName) => {
    const request = indexedDB.deleteDatabase(databaseName)
    return new Promise<"deleted" | "blocked">((resolve, reject) => {
      request.onsuccess = () => resolve("deleted")
      request.onblocked = () => resolve("blocked")
      request.onerror = () => reject(request.error)
    })
  }, name)
}

test("first open, reload, Recovery Phrase, and Sign Out/reopen retain Wallet Material", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)
  await expect(
    page.getByText("New Wallet created in this browser")
  ).toBeVisible()

  const first = await readInstallation(page)
  expect(first.recoveryPhrase.split(" ")).toHaveLength(12)

  await page.reload()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()
  expect((await readInstallation(page)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await page.getByRole("link", { name: "Recovery Phrase" }).click()
  await page.getByRole("button", { name: "Reveal recovery phrase" }).click()
  await expect(
    page.getByRole("heading", { name: "Reveal your Recovery Phrase?" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Reveal phrase" }).click()
  await expect(
    page
      .getByRole("listitem")
      .filter({
        hasText: first.recoveryPhrase.split(" ")[0],
      })
      .first()
  ).toBeVisible()

  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()
  await expect(page).toHaveURL(/\/$/)

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
  expect((await readInstallation(page)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )
})

test("concurrent first open in two tabs reuses one stable Recovery Phrase", async ({
  context,
}) => {
  const firstPage = await context.newPage()
  const secondPage = await context.newPage()
  await Promise.all([installNip07(firstPage), installNip07(secondPage)])
  await Promise.all([firstPage.goto("/"), secondPage.goto("/")])

  await Promise.all([
    firstPage
      .getByRole("button", { name: "Continue with browser extension" })
      .click(),
    secondPage
      .getByRole("button", { name: "Continue with browser extension" })
      .click(),
  ])
  await Promise.all([finishOpening(firstPage), finishOpening(secondPage)])

  await expect(firstPage).toHaveURL(/\/wallet$/)
  await expect(secondPage).toHaveURL(/\/wallet$/)
  const [firstInstallation, secondInstallation] = await Promise.all([
    readInstallation(firstPage),
    readInstallation(secondPage),
  ])
  expect(firstInstallation.recoveryPhrase).toBe(
    secondInstallation.recoveryPhrase
  )
  expect(firstInstallation.databaseName).toBe(secondInstallation.databaseName)
})

test("reports the accepted Wallet initialization sequence", async ({
  page,
}) => {
  await installNip07(page)
  await page.goto("/")
  await page.evaluate(() => {
    const observedStages: string[] = []
    const captureActiveStage = () => {
      const label = document
        .querySelector('[aria-current="step"]')
        ?.textContent?.trim()
      if (label && observedStages.at(-1) !== label) observedStages.push(label)
    }
    new MutationObserver(captureActiveStage).observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    const testWindow = window as Window & {
      __npubcashObservedStages?: string[]
    }
    testWindow.__npubcashObservedStages = observedStages
  })

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(page.getByText("0 sat", { exact: true })).toBeVisible()

  const observedStages = await page.evaluate(
    () =>
      (window as Window & { __npubcashObservedStages?: string[] })
        .__npubcashObservedStages ?? []
  )
  expect(observedStages).toEqual([
    "Verifying signer",
    "Opening local Wallet",
    "Starting Coco",
    "Connecting npub.cash",
    "Checking payments",
  ])
})

test("restoration refuses a different extension Public Key", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)

  await page.evaluate((publicKey) => {
    localStorage.setItem("npubcash-test-public-key", publicKey)
  }, PUBLIC_KEY_B)
  await page.reload()

  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(page.getByText(/different Public Key/)).toBeVisible()
  const walletDatabases = await page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name)
      .filter((name) => name?.startsWith("npubcash-wallet-v1:"))
  )
  expect(walletDatabases).toEqual([`npubcash-wallet-v1:${PUBLIC_KEY_A}`])
})

test("identity switching creates isolated Public-Key databases", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)
  const first = await readInstallation(page)

  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()
  await page.evaluate((publicKey) => {
    localStorage.setItem("npubcash-test-public-key", publicKey)
  }, PUBLIC_KEY_B)
  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await finishOpening(page)
  await expect(page).toHaveURL(/\/wallet$/)

  const second = await readInstallation(page, PUBLIC_KEY_B)
  expect(second.databaseName).not.toBe(first.databaseName)
  expect(second.recoveryPhrase).not.toBe(first.recoveryPhrase)
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases())
        .map((database) => database.name)
        .filter((name) => name?.startsWith("npubcash-wallet-v1:"))
        .sort()
    )
  ).toEqual(
    [
      `npubcash-wallet-v1:${PUBLIC_KEY_A}`,
      `npubcash-wallet-v1:${PUBLIC_KEY_B}`,
    ].sort()
  )
})

test("missing wallet seed refuses to open and confirms destructive removal", async ({
  page,
}) => {
  await installNip07(page)
  await page.goto("/")
  await page.evaluate(async (name) => {
    const request = indexedDB.open(name)
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }, `npubcash-wallet-v1:${PUBLIC_KEY_A}`)

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(
    page.getByText(/Recovery Phrase record is missing/)
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Remove stranded local Wallet" })
    .click()
  await expect(
    page.getByRole("heading", { name: "Remove local Wallet data?" })
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Remove local Wallet", exact: true })
    .click()
  await expect(
    page.getByText("Sign in with Nostr", { exact: true })
  ).toBeVisible()
})

test("missing Coco database reuses the stable seed and warns about absent local data", async ({
  page,
}) => {
  await installNip07(page)
  await signIn(page)
  const first = await readInstallation(page)

  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()
  expect(await deleteDatabase(page, first.databaseName)).toBe("deleted")

  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(
    page.getByText("Local Wallet database was missing")
  ).toBeVisible()
  expect((await readInstallation(page)).recoveryPhrase).toBe(
    first.recoveryPhrase
  )
})

test("Sign Out tears down Coco and closes IndexedDB", async ({ page }) => {
  await installNip07(page)
  await signIn(page)
  const installation = await readInstallation(page)

  await page.getByRole("link", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Sign Out" }).click()

  expect(await deleteDatabase(page, installation.databaseName)).toBe("deleted")
})

test("missing, rejected, and non-durable browser storage have explicit states", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: async () => false },
    })
  })
  await page.goto("/")
  await expect(
    page.getByRole("button", { name: "Continue with browser extension" })
  ).toBeDisabled()
  await expect(page.getByText("Storage may be temporary")).toBeVisible()

  await page.addInitScript(() => {
    Object.defineProperty(window, "nostr", {
      configurable: true,
      value: {
        getPublicKey: async () => {
          throw new Error("Permission rejected")
        },
        signEvent: async () => {
          throw new Error("Permission rejected")
        },
      },
    })
  })
  await page.reload()
  await page
    .getByRole("button", { name: "Continue with browser extension" })
    .click()
  await expect(page.getByText("Wallet could not open safely")).toBeVisible()
  await expect(page.getByText("Permission rejected")).toBeVisible()
})

test("phone navigation and Recovery confirmation work from the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installNip07(page)
  await signIn(page)

  const settingsLink = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Settings" })
  await expect(settingsLink).toBeVisible()
  await settingsLink.focus()
  await page.keyboard.press("Enter")

  const recoveryLink = page.getByRole("link", { name: "Recovery Phrase" })
  await recoveryLink.focus()
  await page.keyboard.press("Enter")

  const revealButton = page.getByRole("button", {
    name: "Reveal recovery phrase",
  })
  await revealButton.focus()
  await page.keyboard.press("Enter")
  const dialogTitle = page.getByRole("heading", {
    name: "Reveal your Recovery Phrase?",
  })
  await expect(dialogTitle).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(dialogTitle).toBeHidden()
  await expect(revealButton).toBeFocused()
})
