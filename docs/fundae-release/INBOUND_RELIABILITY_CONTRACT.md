# Inbound reliability contract

Status: local implementation, all feature flags OFF. No live Graph, Calendly, Make, SQL migration or external alert has been exercised.

## Ownership and flow

- Make is scheduler-only: every five minutes it sends an empty authenticated POST to `/api/internal/inbound/mailbox`.
- Data Brain owns Microsoft Graph delta tokens, provider-event ledger, correlation, classification and all stop effects.
- Calendly sends `invitee.created` directly to `/api/webhooks/calendly`; Make never terminates or re-signs that webhook.
- `OUTBOUND_MASTER_ENABLED=false` does not prevent recording inbound facts. `INBOUND_MAILBOX_ENABLED` and `CALENDLY_WEBHOOK_ENABLED` are independent and default to `false`.

## Graph evidence and cursor

- Inbox is read through folder-level `messages/delta` with `Prefer: IdType="ImmutableId"` on every request.
- A page is processed before its next/delta cursor is advanced. A crash therefore replays the page; the durable ledger deduplicates each immutable provider ID.
- Cursor advancement is compare-and-set by the previous cursor hash. Concurrent or stale workers fail closed.
- The first run requires an explicit `INBOUND_MAILBOX_BOOTSTRAP_FROM` ISO timestamp and requests only created messages; it never silently scans the full mailbox history.
- Human classification uses Graph `uniqueBody` requested as text, then cuts quoted-history separators defensively. A preview alone can never trigger BAJA. Message text is transient and is never persisted or logged.

## Correlation and stops

- Allowed evidence: exact Outlook `conversationId`, or the shared domain-separated
  `SHA-256("internet-message-id-v1\\0" + trimmed Message-ID)` digest of `In-Reply-To`,
  `References`, `Original-Message-ID` and `X-Original-Message-ID` matched to stored provider evidence.
- The outbound Sent Items confirmer and inbound correlator call the same helper. The provider
  Message-ID and message body are not stored. If neither a persisted conversation binding nor a
  matching reference digest exists, the event is `manual_review`; email is never a fallback.
- Email-only matching is forbidden. Zero or multiple contacts produce `manual_review` plus one idempotent row in the service-only `inbound_alerts` queue.
- Every human reply stops the active marketing sequence through `reply_received`.
- `BAJA` additionally records canonical `unsubscribe`, producing global suppression through the existing campaign contract.
- A positive reply records `positive_reply` through the existing idempotent HubSpot task contract.
- Only an explicit delivery-status report containing a `5.x.x` enhanced status code records `bounce_hard`. `4.x.x` is transient and unknown DSN evidence goes to manual review.

## Calendly

- Verify HMAC-SHA256 over `timestamp + "." + raw body` from `calendly-webhook-signature`, in constant time, with a five-minute replay window.
- Accept only `invitee.created` with active status.
- Correlate `payload.tracking.utm_campaign` plus `payload.tracking.utm_content`; names and email addresses are never used for matching or persistence.
- Duplicate invitee URIs are idempotent. Unmatched or ambiguous UTM identifiers go to `manual_review`.

## Gates

1. Apply `20260819143000_inbound_reliability.sql` in authorized staging and verify RLS/grants/RPC concurrency.
2. Confirm Graph application permission and mailbox policy for least-privilege `Mail.Read`; run delta/cursor crash canaries.
3. Create the Calendly subscription interactively, preserve the signing key in environment storage and verify a real signed webhook.
4. Reconnect Make MCP, discover the exact HTTP module/version, validate module and blueprint, choose the connection interactively, and keep the scenario inactive.
5. Exercise unmatched, ambiguous, permanent/transient DSN, BAJA, positive reply and Calendly replay alert paths before activation.
