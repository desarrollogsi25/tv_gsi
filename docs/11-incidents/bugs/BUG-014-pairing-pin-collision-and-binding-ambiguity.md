# BUG-014 — Identidad de sesión de emparejamiento y resolución de ambigüedad

> **Riesgo asociado:** RSK-029
> **Detectado:** 2026-10-09
> **Estado:** Mitigado y desplegado; colisión de PIN verificada live por identidad de sesión. Retest live de binding/TTL con pantalla física pendiente.

## Diagnóstico

El cliente genera y conserva un PIN numérico de cuatro dígitos en `TVPlayer.jsx`; el socket pendiente entrega ese PIN en el handshake. Antes del cambio, el servidor guardaba sesiones en `waitingScreens` por `socket.id`, pero `bind-screen` recibía solamente el PIN y elegía la primera entrada coincidente. Dos pantallas con el mismo PIN podían por tanto seleccionar sockets distintos de la pantalla elegida en la consola. La ruta también ignoraba el booleano de la operación de socket y podía informar éxito aunque no hubiera una pantalla conectada. El cliente administrativo no bloqueaba solicitudes duplicadas. La desconexión ordinaria quitaba la entrada, pero no había vencimiento de sesión.

## Resolución

El PIN sigue siendo un código de presentación y no es una identidad. Cada registro obtiene un `pairingSessionId` UUID independiente, asociado en memoria al socket exacto. `POST /api/admin/bind-screen` recibe `{ pairingSessionId, tv_uuid }`; no se requiere migración ni cambio de persistencia. El ciclo es `pending → binding → bound`, con vencimiento de cinco minutos medido desde el registro, incluso si el binding empezó antes del plazo. La sesión queda consumida durante cinco minutos como tombstone: mismo perfil es idempotente y devuelve el resultado guardado; otro perfil obtiene HTTP 409; una sesión vencida o desconectada obtiene HTTP 410; ID desconocido obtiene HTTP 404.

El servidor reclama atómicamente la sesión antes de la transacción de perfil, bloquea la fila de perfil, comprueba que la sesión siga activa antes del commit y revierte si el socket/deadline ya no es válido. La ruta solo responde éxito después de que el gestor termine el enlace y emita la asignación. La UI bloquea selección y acciones mientras la petición está en curso. Al vencer el TTL, el servidor emite `pairing:expired` y desconecta el socket; el controlador compartido de `TVPlayer` genera un PIN distinto, crea un nuevo socket y el servidor registra un nuevo `pairingSessionId`. Socket.IO por sí solo no reconecta una desconexión iniciada por servidor.

## Evidencia de validación

`tests/pairing-session.test.js` cubre colisión de PIN con selección por ID exacto, consumo/idempotencia, conflicto 409 y desconocido 404, expiración 410, doble petición concurrente con una sola escritura/asignación, y reconexión tras TTL observando un segundo registro de espera con PIN e ID de sesión nuevos. `tests/device-auth.test.js` (20/20) y `tests/rbac.test.js` (14/14) pasaron junto con las pruebas de pairing: 39/39. `npm run build` en `frontend/` completó con Vite; Node 20.18 mostró aviso de que requiere 20.19+, aunque el build terminó correctamente. La reconexión se probó con el controlador real y un servidor Socket.IO local de integración; no se hizo retest en televisor físico.

Retest Docker live del 2026-10-09: dos sockets pendientes con el mismo PIN de prueba aparecieron en `GET /api/admin/waiting-screens` como dos sesiones y ambos IDs eran distintos. Los sockets se desconectaron al finalizar, sin vincular perfiles ni modificar la base de datos. El flujo live de consumo/binding y el TTL completo de cinco minutos no se ejecutaron sobre perfiles reales.

## Referencias

- Implementación: `src/services/pairingSessionManager.js`, `src/sockets/index.js`, `src/routes/admin.js`, `frontend/src/utils/waitingPairingSocket.js`, `frontend/src/components/TVPlayer.jsx`, `frontend/src/components/admin/TVRegister.jsx`.
- Caso de prueba: `docs/13-testing/results/TC-PAIRING-SESSION-001.md`.
