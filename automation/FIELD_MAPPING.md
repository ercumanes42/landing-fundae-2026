# Field Mapping

| Excel / Google Sheets | Data Brain | HubSpot |
| --- | --- | --- |
| `campaign_id` | `campaigns.external_id` | `fundae_campaign_id` |
| `contact_id` / `cid` | `campaign_contacts.external_contact_id` | `fundae_contact_id` |
| `account_id` | `campaign_contacts.external_account_id` | `fundae_account_id` on company/contact |
| `variante_nombre` | `variant` | `fundae_variant` |
| `recurso_asignado` | `magnet` | `fundae_magnet` |
| `lote_envio` | `lot` | campaign reporting field |
| `paso_actual` | `current_step` | `fundae_sequence_status` |
| `estado_secuencia` | `sequence_status` | `fundae_sequence_status` |
| `estado_envio` | `next_delivery_status` | timeline only |
| `ultimo_envio_at` | last delivery event | timeline only |
| `conversation_id` | `outlook_conversation_id` | timeline only |
| `respondio` / `tipo_respuesta` | `reply_type` and event | `fundae_reply_type` |
| `reunion_reservada` | `meeting_booked_at` | lifecycle/deal workflow |
| `oportunidad_creada` / `valor_oportunidad` | event and `deal_value` | deal/pipeline |

Google Sheets must add these operational columns if they are not already present: `last_delivery_status`, `lock_token`, `lock_expires_at`, `last_error_code`, and `last_error_message`.
