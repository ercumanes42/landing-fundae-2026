# Make + Outlook 365 Setup

## Scenario 1: Email sender

1. Scheduler: run at the four approved Madrid time slots.
2. Google Sheets Search Rows: select only due rows with `next_delivery_status=PENDING`, `validacion_pre_envio=OK`, no response, no hard bounce, no meeting and `paso_actual` from 1 to 5.
3. Make Data Store Get Record: key `campaign_id:contact_id:paso_actual`. Stop when a non-expired lock exists.
4. Conditional contact filter: when `habilitado_envio=CONDICIONADO`, inspect the primary contact. Stop the secondary when its primary has replied, booked, unsubscribed, bounced, or stopped.
5. Google Sheets Update Row: set `next_delivery_status=LOCKED`, `lock_token`, `locked_at`, and `lock_expires_at` before Outlook is called.
6. Outlook 365 Send Email for step 1; Reply/Send in the stored conversation for steps 2-5.
7. Make Data Store Put Record after a confirmed Outlook result.
8. Google Sheets Update Row: store message/conversation IDs, last delivery result, increment `paso_actual`, and set the next step to `PENDING`. Set sequence to `COMPLETED` only after email 5.
9. POST the signed operational payload to Data Brain `/api/campaign/operations`.
10. Sleep 45 seconds before the next row.

Never retry an unknown Outlook timeout until the message and conversation IDs have been searched. Retry only transient failures at 1 minute, 15 minutes and 1 hour; then route the row to manual review.

## Scenario 2: Outlook reply monitor

1. Watch Outlook inbox.
2. Match `conversation_id` or `message_id_inicial` to the Google Sheets row.
3. Classify response: POSITIVA, NEGATIVA, INFORMACION, DERIVACION, REUNION or BAJA.
4. Set `estado_secuencia=DETENIDA` and clear any active lock.
5. POST `reply_received` to Data Brain with the Make signature.
6. Create or update the corresponding HubSpot task/workflow through Data Brain's direct HubSpot sync.

## Scenario 3: Landing events

The landing calls Data Brain directly with the `cid`. Make receives only operational events such as confirmed Calendly booking or Outlook delivery results. Do not pass email addresses in URLs or landing webhook payloads.

## Signed Data Brain Request

Use the raw JSON body and calculate `HMAC-SHA256(rawBody, MAKE_WEBHOOK_SECRET)`. Send the lowercase hex result in `X-Make-Signature`.

```json
{
  "campaign_external_id": "FUNDAE_2026_EMAIL_V1",
  "contact_id": "F26-A-0001",
  "event_name": "delivery_sent",
  "source_event_id": "outlook-message-id",
  "sequence_status": "active",
  "next_delivery_status": "pending",
  "last_delivery_status": "sent",
  "current_step": 2,
  "next_scheduled_at": "2026-09-08T09:30:00+02:00",
  "outlook_message_id": "...",
  "outlook_conversation_id": "..."
}
```
