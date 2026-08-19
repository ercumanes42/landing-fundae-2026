# Baja segura y política operativa

Este flujo prepara **una copia operacional**. Nunca escribe sobre el Excel maestro y nunca envía correos.

## 1. Copia controlada

La copia materializada es `data-private/Base_FUNDAE_2026_CONTROLADA_OFF_V1.xlsx`. Se genera desde el maestro
inmutable y `automation/make/fundae_copy_matrix_v1.json` mediante `artifact-tool`; el maestro no se sobrescribe.
Los 4.695 cuerpos contienen exactamente un `{{unsubscribe_url}}`, identidad del remitente y ninguna otra
variable pendiente. La criptografía y el registro de tokens pertenecen a Data Brain.

El reporte agregado sin PII se conserva en
`automation/campaign-reports/FUNDAE_2026_CONTROLLED_COPY_REPORT.json`.

## 2. Obtener el enlace desde Data Brain

Make debe enviar, con el HMAC descrito en `MAKE_SETUP.md`:

`POST /api/campaign/unsubscribe-link`

```json
{
  "campaign_external_id": "FUNDAE_2026_EMAIL_V1",
  "contact_id": "F26-A-0001",
  "token_version": 1
}
```

Solo se acepta `unsubscribe_url` del origen configurado, ruta fija `/baja`, sin parámetros adicionales y token
`u1.<43 caracteres base64url>`. Make sustituye el placeholder en memoria. No guarda ni registra la URL/token.
Cualquier timeout, error o respuesta distinta bloquea el envío.

## 3. Autorizar justo antes de Outlook

Después de `LOCKED` y de montar el HTML, Make debe firmar y enviar:

`POST /api/campaign/delivery-authorization`

```json
{
  "campaign_external_id": "FUNDAE_2026_EMAIL_V1",
  "contact_id": "F26-A-0001",
  "execution_key": "FUNDAE_2026_EMAIL_V1:F26-A-0001:email:E1"
}
```

El backend comprueba atómicamente supresión global/local, estado de campaña, ejecución y lease de 120 segundos.
**Solo `authorized:true` permite llamar a Outlook.** Cualquier otro valor, 2xx ambiguo, timeout o error bloquea.

## 4. Gate operativo por contacto

La política `FUNDAE_CUSTOMER_SIMILAR_SERVICES_2026_V1` aplica la decisión aprobada para clientes actuales o
anteriores y servicios propios similares. No exige evidencia jurídica individual ni consentimiento nuevo.
No es asesoramiento jurídico.

Antes de autorizar un contacto deben estar en `CLEAR`: `unsubscribe_status`, `opposition_status`,
`hard_bounce_status`, `suppression_status` y `duplicate_status`. Además,
`campaign_authorization=AUTHORIZED` y `validacion_pre_envio=OK`. Cualquier `STOP`, `PENDING_RECHECK`,
`PENDING`, `REVOKED` o valor desconocido bloquea. Reply humano o Calendly también detienen la secuencia.

## Pruebas y puerta de salida

```powershell
npm run campaign:unsubscribe:test
$env:CAMPAIGN_FILE = (Resolve-Path ".\data-private\Base_FUNDAE_2026_CONTROLADA_OFF_V1.xlsx").Path
npm run campaign:validate -- --require-ready
```

`--require-ready` debe fallar mientras la validación, revalidación técnica o autorización directa estén
pendientes. No debe fallar por copies, baja ni evidencia individual. Antes del piloto deben probarse endpoint
de baja, autorización JIT, carrera baja-LOCKED, supresión por `email_hash` entre campañas y escenarios Make
reales exportados. Los JSON de `automation/make/` siguen siendo especificaciones `importable=false` y
`production_ready=false`.
