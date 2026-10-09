# Breaking changes

## v2.2.0 — Autenticación obligatoria de dispositivos

- `GET /api/tv/:tv_uuid/playlist` requiere `X-Device-Token`. Las peticiones sin token, con token inválido o asociado a otra pantalla reciben `401 Unauthorized`.
- El WebSocket `/control` requiere credenciales de dispositivo en el handshake. `tv_uuid` por sí solo ya no autentica la pantalla.
- Las pantallas activas sin `device_token_hash` deben volver a vincularse desde `/admin/register` para recibir una credencial de dispositivo.
- La vinculación administrativa identifica la sesión con `pairingSessionId`; el PIN es solo visual y no debe utilizarse como identidad de sesión. Las sesiones vencen en cinco minutos.

Consulte [DEV-RUN-003 — Revinculación y puesta en servicio de pantallas](../07-operations/runbooks/DEV-RUN-003-screen-pairing-recommission.md) y las [notas de v2.2.0](releases/v2.2.0.md).
