import { describe, expect, test } from "bun:test"

import {
  SignerVaultCorruptRecordError,
  SignerVaultStorageError,
  SignerVaultUnsupportedRecordError,
} from "./signer-vault"
import { classifySignerRecordFailure } from "./signer-record-failure"

describe("classifySignerRecordFailure", () => {
  test("keeps corrupt and unsupported records non-retryable", () => {
    expect(
      classifySignerRecordFailure(new SignerVaultCorruptRecordError())
    ).toMatchObject({ kind: "signer-record-corrupt", retryable: false })
    expect(
      classifySignerRecordFailure(new SignerVaultUnsupportedRecordError())
    ).toMatchObject({ kind: "signer-record-unsupported", retryable: false })
  })

  test("keeps storage and migration failures retryable", () => {
    expect(classifySignerRecordFailure(new SignerVaultStorageError())).toEqual({
      kind: "runtime-failed",
      message:
        "The saved signer record could not be read. Check browser storage and retry.",
      retryable: true,
    })
  })
})
