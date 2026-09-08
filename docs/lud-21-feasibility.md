# LUD-21 feasibility

Research date: 2026-09-08. Decision: implement payment-status verification with `preimage: null`, including for settled invoices. See the [API reference](../packages/docs/docs/api/endpoints.md#verify-invoice-payment) for the implemented behavior.

Payment-status verification fits the current server architecture. Full interoperability has one unresolved dependency: standard Cashu mint quote responses do not expose the incoming invoice's payment preimage.

## Protocol requirements and limits

[LUD-21](https://github.com/lnurl/luds/blob/luds/21.md) adds an optional `verify` URL to the LNURL-pay callback response. Its verification examples return `status`, `settled`, `preimage`, and the original invoice as `pr`, or `status: "ERROR"` with a reason for an unknown invoice. The settled example includes a string preimage; the unsettled example uses `null`.

The document does **not explicitly define** whether `settled: true` with `preimage: null` is allowed. Consequently, a status-only endpoint is technically feasible, but its compatibility with LUD-21 clients needs confirmation before advertising full support. This is an interpretation of an unspecified case, not an explicit prohibition in the specification. [Source: LUD-21](https://github.com/lnurl/luds/blob/luds/21.md).

[NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md) provides a mint quote lookup API. The BOLT11 mint quote schema in [NUT-23](https://github.com/cashubtc/nuts/blob/main/23.md#mint-quote) includes the invoice and accounting/state fields, but no preimage. Both `PAID` and `ISSUED` mean the invoice has been paid; issuance only distinguishes whether ecash has subsequently been created. The `payment_preimage` field described for BOLT11 **melt** quotes concerns outgoing payments and does not provide a standard preimage retrieval mechanism for incoming mint quotes. [Source: NUT-23](https://github.com/cashubtc/nuts/blob/main/23.md).

[NUT-17](https://github.com/cashubtc/nuts/blob/main/17.md#notifications) sends the corresponding mint quote response as its notification payload. Using WebSockets therefore supplies timely payment status without adding a standardized preimage source.

## Fit with this repository

- The [LNURL callback](../packages/server/src/controller/lnurlController.ts) already persists the mint quote and returns its invoice. It could add a `verify` URL after persistence.
- [MintQuote](../packages/server/src/domain/mintQuote/MintQuote.ts) stores the original invoice and payment state, but no preimage.
- [QuoteObservationHandler](../packages/server/src/domain/mintQuoteMonitoring/QuoteObservationHandler.ts) centralizes state changes from the existing [polling](../packages/server/src/domain/mintQuoteMonitoring/QuotePollingService.ts) and [WebSocket](../packages/server/src/domain/mintQuoteMonitoring/QuoteWebSocketService.ts) services. A verification endpoint can read persisted state and treat `PAID` or `ISSUED` as settled. Any added refresh should feed observations through this existing handler.

Use a separate, unpredictable verification token mapped to the stored quote. Do not put the upstream mint quote ID in the public URL: [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md#requesting-a-mint-quote) identifies it as a secret whose disclosure can allow another party to claim tokens when minting is not protected by NUT-20. The opaque token is an implementation recommendation, not a LUD-21 requirement.

## Implementation decision

The LNURL callback now returns an opaque verification URL. Its endpoint reads persisted quote state, reports `PAID` and `ISSUED` as settled, returns the original invoice, and always sets `preimage: null`. Existing mint monitoring supplies updates; verification requests do not trigger upstream requests. The API documentation states that clients requiring a preimage cannot obtain proof of payment from this endpoint.

Verification tokens are random, separate from upstream quote IDs, and persisted with a unique index in both PostgreSQL and SQLite. Existing quotes remain intact without verification tokens. Verification does not recheck recipient eligibility because blocks do not invalidate previously issued invoices.
