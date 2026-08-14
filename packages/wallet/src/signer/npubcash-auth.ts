import { normalizePublicKey, type Nip07Event } from "./nip07"

export interface NostrEventSigner {
  signEvent(event: Nip07Event): Nip07Event | Promise<Nip07Event>
}

export type NpubCashEventTemplate = Omit<Nip07Event, "id" | "pubkey" | "sig">

export type NpubCashSignedEvent = Required<
  Pick<Nip07Event, "id" | "pubkey" | "sig">
> &
  NpubCashEventTemplate

function isHex(value: unknown, length: number): value is string {
  return (
    typeof value === "string" &&
    value.length === length &&
    /^[0-9a-f]+$/i.test(value)
  )
}

function assertUnchangedTemplate(
  template: NpubCashEventTemplate,
  signed: Nip07Event
): void {
  if (
    signed.kind !== template.kind ||
    signed.created_at !== template.created_at ||
    signed.content !== template.content ||
    JSON.stringify(signed.tags) !== JSON.stringify(template.tags)
  ) {
    throw new Error("The Nostr Signer changed the authentication request.")
  }
}

export function createNpubCashSigner(
  expectedPublicKey: string,
  signer: NostrEventSigner
): (template: NpubCashEventTemplate) => Promise<NpubCashSignedEvent> {
  const normalizedExpectedPublicKey = normalizePublicKey(expectedPublicKey)

  return async (template) => {
    const signed = await signer.signEvent(template)
    assertUnchangedTemplate(template, signed)

    if (
      normalizePublicKey(signed.pubkey ?? "") !== normalizedExpectedPublicKey
    ) {
      throw new Error(
        "The Nostr Signer returned an event for a different Public Key."
      )
    }
    if (!isHex(signed.id, 64) || !isHex(signed.sig, 128)) {
      throw new Error("The Nostr Signer returned an invalid signed event.")
    }

    return signed as NpubCashSignedEvent
  }
}
