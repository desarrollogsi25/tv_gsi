# DEV-RUN-003 — Revinculación y puesta en servicio de pantallas

> **Tipo:** Runbook operativo
> **Versión:** 1.0
> **Fecha:** 2026-10-09
> **Responsable:** Operaciones de Nexus TV
> **Sistemas:** Panel administrativo, API Nexus TV, Socket.IO `/control` y navegador Kiosk
> **Incidentes relacionados:** BUG-012, BUG-013, BUG-014
> **Riesgos relacionados:** RSK-025, RSK-028, RSK-029

## 1. Propósito y alcance

Procedimiento para volver a vincular una pantalla que, tras la migración de seguridad, aparece en modo de espera y solicita un PIN. Aplica a pantallas existentes sin `device_token_hash` y a pantallas que deban vincularse de nuevo después de revocar sus credenciales.

La migración exige credenciales de dispositivo para el WebSocket `/control` y para `GET /api/tv/:tv_uuid/playlist`. El UUID identifica la pantalla, pero ya no la autentica. Las pantallas activas sin hash solicitarán un PIN en su primer arranque bajo el flujo actualizado.

## 2. Requisitos previos

- Acceso al panel con una cuenta administrativa autorizada.
- Conectividad entre la pantalla, el servidor Nexus TV y los puertos publicados para frontend y backend.
- Origen LAN de la pantalla incluido en `ALLOWED_ORIGINS` cuando se accede por una IP o FQDN diferente del origen configurado.
- El operador puede identificar físicamente la pantalla y el perfil que le corresponde.
- La pantalla ejecuta la versión del reproductor compatible con `X-Device-Token` y `pairingSessionId`.

## 3. Procedimiento de revinculación

1. Encienda o recargue el navegador Kiosk de la pantalla. Espere a que muestre el PIN y aparezca como pantalla pendiente.
2. En un equipo de operador, abra `/admin/register` e inicie sesión.
3. Localice la pantalla pendiente por el PIN visible y confirme que corresponde al dispositivo físico que se está atendiendo. Si hay PINs iguales, trate cada fila como una sesión distinta; confirme la identidad física antes de seleccionar el perfil.
4. Seleccione el perfil correcto en la fila pendiente y pulse la acción de vinculación una sola vez. El panel envía el `pairingSessionId` asociado a esa fila. El PIN es solo una ayuda visual y no identifica la sesión. No copie ni invente un ID de sesión manualmente.
5. Espere el resultado del panel. La operación se considera completada únicamente cuando el servidor finaliza la transición `pending → binding → bound` y responde éxito.
6. Confirme que la pantalla sale del modo de espera y carga el perfil asignado. La credencial se entrega al reproductor y se almacena en el dispositivo; el backend conserva su hash.
7. Compruebe que la pantalla continúa conectada y que carga su playlist. No registre tokens en capturas, tickets ni logs de soporte.

## 4. TTL, reintentos y protección contra duplicados

Una sesión de espera vence cinco minutos después de su registro. El servidor la consume al completar la vinculación; no puede usarse para asignarla a un perfil diferente. Una sesión reclamada por otro perfil devuelve `409`, una sesión vencida devuelve `410` y un `pairingSessionId` desconocido devuelve `404`.

Si el TTL vence antes de vincular, actualice la vista del panel y espere el nuevo registro de espera. El reproductor debe reconectar, generar un PIN nuevo y registrar una nueva sesión; no reutilice el PIN ni la fila vencida. Si una petición está en curso, espere su respuesta antes de reintentar. El cliente y el servidor protegen contra envíos simultáneos duplicados.

## 5. Diagnóstico de fallos

| Síntoma | Comprobación y acción |
|---|---|
| No aparece una pantalla pendiente | Compruebe que el Kiosk carga la URL correcta, que frontend y backend están saludables y que la red permite el acceso. Revise CORS/`ALLOWED_ORIGINS` para el origen LAN exacto. Recargue el Kiosk y espere a que se registre de nuevo. |
| La sesión devuelve `410` | El TTL venció o el socket se desconectó. Actualice el panel y vincule la nueva sesión registrada; no intente reutilizar la anterior. |
| La sesión devuelve `409` | La sesión fue reclamada para otro perfil. Verifique la asignación con el administrador responsable; no fuerce un segundo binding. |
| La sesión devuelve `404` | La fila ya no corresponde a una sesión viva o el ID no es el emitido por el servidor. Vuelva a cargar la lista y elija la sesión pendiente actual. |
| Playlist o WebSocket devuelve `401` tras vincular | No solicite ni copie el token. Recargue el reproductor para que reintente con la credencial local. Si persiste, escale al administrador para verificar estado activo, revocación y hash de dispositivo. |
| No hay red o el registro no se repite | Restaure la conectividad y vuelva a cargar el Kiosk. Si no vuelve a mostrar una sesión nueva, recopile hora, UUID de pantalla y mensajes de error sin incluir credenciales y escale a soporte. |

## 6. Recuperación y rollback

Ante un fallo, detenga nuevos intentos de vinculación y mantenga la pantalla sin asignar hasta recuperar conectividad o corregir la selección del perfil. Un vencimiento de sesión no requiere cambios de base de datos: se registra una sesión nueva al reconectar.

No quite la exigencia de `X-Device-Token`, no restaure autenticación basada solo en UUID y no revierta la migración de hashes como procedimiento operativo. Tampoco recree volúmenes de PostgreSQL. Si se requiere rollback de software, coordine una reversión conjunta a una versión compatible de frontend y backend con el responsable de release; no retroceda solo el frontend o solo el backend. Reanude la revinculación con la versión compatible y las credenciales de dispositivo vigentes.

## 7. Criterios de cierre

- La fila pendiente correcta se vinculó al perfil esperado.
- El reproductor abandonó el modo de espera y cargó contenido.
- La playlist y el WebSocket operan autenticados, sin exponer el token.
- El operador anotó el resultado y cualquier error sin incluir secretos.

## 8. Referencias

- [BUG-012 — Autenticación del WebSocket de TV](../../11-incidents/bugs/BUG-012-unauthenticated-tv-websocket-spoofing.md)
- [BUG-013 — Autenticación del endpoint de playlist](../../11-incidents/bugs/BUG-013-unauthenticated-playlist-endpoint-exposure.md)
- [BUG-014 — Sesiones inequívocas de emparejamiento](../../11-incidents/bugs/BUG-014-pairing-pin-collision-and-binding-ambiguity.md)
- [TC-PAIRING-SESSION-001](../../13-testing/results/TC-PAIRING-SESSION-001.md)
