# TC-PAIRING-SESSION-001 — Identidad, expiración y reconexión de pairing

**Fecha:** 2026-10-09
**Resultado:** Aprobado en pruebas automatizadas locales.
**Entorno:** Servidor Socket.IO/Express de integración en proceso, fake pool transaccional y controlador de socket usado por `TVPlayer`; no se modificó la base de datos activa ni se hizo prueba física.

## Criterios y resultados

| Criterio | Ejecución y evidencia | Resultado |
| --- | --- | --- |
| Colisión de PIN | `pairing PIN collision: exact session ID selects the requested socket`: dos sockets registraron el mismo PIN; `pairingSessionId` eligió el socket solicitado. | PASS |
| Consumo único | `pairing session is consumed once and same-target retries are idempotent`: repetición del mismo perfil devolvió resultado idempotente; perfil distinto devolvió 409; ID inexistente devolvió 404. | PASS |
| Expiración | `pairing expires after TTL, disconnects the waiting socket, and cannot bind`: vencimiento desconectó socket; POST posterior devolvió 410. TTL de producción configurado en cinco minutos; caso usa TTL reducido para ejecución automatizada. | PASS |
| Doble clic / reintento | `concurrent double-click requests produce one bind and return correct HTTP results`: dos POST concurrentes al mismo perfil causaron una escritura y una emisión de asignación, ambas respuestas exitosas; conflicto simultáneo con otro perfil fue rechazado. | PASS |
| TVPlayer tras desconexión por TTL | `TVPlayer waiting-socket controller reconnects with a fresh PIN and server session after TTL`: se observó evento de expiración, nuevo PIN, nuevo socket y segundo registro servidor con `pairingSessionId` distinto; no fue solo una inferencia sobre reconexión automática de Socket.IO. | PASS |
| Regresión BUG-012 / RSK-025 y suite completa | `node -r dotenv/config --test tests/` con `NODE_ENV=test`: 57/57 pruebas pasaron. Incluye 20 device-auth, 14 RBAC, cinco pairing y cobertura existente de auth, playlists y ventanas horarias; se incluye autenticación válida, token inválido, rechazo de identidad cruzada, reconexión autenticada y unlink/revocación. | PASS |
| Build frontend | `npm run build` desde `frontend/`: Vite transformó 126 módulos y generó bundle correctamente. Node v20.18 mostró aviso de versión mínima 20.19+, pero el build terminó con código 0. | PASS (con aviso de runtime) |

El primer intento de regresión sin `NODE_ENV=test` y sin precargar `.env` falló por configuración de entorno (`JWT_SECRET` ausente y validación de `PG_PASSWORD` de producción); se repitió con el entorno de test y la carga de dotenv como se documenta arriba. No se reporta ese intento como prueba aprobada.

## Contrato comprobado

- `POST /api/admin/bind-screen` consume `{ pairingSessionId, tv_uuid }`.
- Transición correcta responde éxito solo tras completar el callback de escritura y emitir asignación.
- ID desconocido: 404; sesión vencida/desconectada/consumida no recuperable: 410; sesión reclamada por otro perfil: 409.
- Repetir el mismo binding para el mismo perfil devuelve el resultado cacheado y no repite escritura ni emisión.
- No requiere migración de esquema: identidad y tombstones son estado en memoria.

## Limitaciones

La prueba de reconexión ejercita el mismo controlador de socket integrado en `TVPlayer` contra Socket.IO local, incluyendo el evento server-initiated TTL y nuevo registro. No se verificó visualmente un televisor físico ni una instancia Docker desplegada.
