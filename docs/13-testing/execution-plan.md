# Nexus TV Enterprise — Plan Secuencial de Ejecución de QA

> **Documento:** Sequential QA Execution Plan (Fases 1 a 11)  
> **Versión:** 2.0.0 Dual-Hub  
> **Fecha:** 2026-10-08  
> **Metodología:** Pruebas controladas no destructivas sin alteración del código fuente  

---

## Estructura de las Fases de Prueba

```
FASE 1: Smoke Test ──► FASE 2: API & Backend ──► FASE 3: Pantallas / Playback ──► FASE 4: Playlists & Horarios
                                                                                           │
FASE 8: Multimedia ◄── FASE 7: Broadcast Override ◄── FASE 6: Controles Remotos ◄── FASE 5: PIN & Pairing
        │
        ▼
FASE 9: Edge Cases & Resiliencia ──► FASE 10: Visual & Responsividad ──► FASE 11: Regresión & Cierre
```

---

### FASE 1: Smoke Test del Sistema
* **Objetivo:** Confirmar que todos los contenedores (`tv-db`, `tv-backend`, `tv-frontend`) están saludables, enrutando tráfico y listos para interactuar.
* **Casos Asociados:** `TC-001`.
* **Evidencia Necesaria:** Salida de `docker compose ps` (estado `healthy`), respuesta JSON de `http://localhost:23002/api/status` y HTTP 200 de `http://localhost:28080/`.
* **Criterio de Aprobación:** Todos los servicios arriba sin reinicios imprevistos ni errores en logs iniciales.
* **Riesgos:** Bloqueo de puertos en host si otro proceso ocupa `25432`, `23002` o `28080`.

---

### FASE 2: API y Backend (Pruebas Read-Only)
* **Objetivo:** Validar la integridad y consistencia de los endpoints REST del backend sin mutar datos.
* **Casos Asociados:** `TC-002`, verificación de `/api/admin/screens`, `/api/admin/playlists`, `/api/admin/stats`.
* **Evidencia Necesaria:** Payloads JSON capturados vía curl/PowerShell comparados contra el esquema esperado.
* **Criterio de Aprobación:** Respuestas HTTP 200 con formato `{success: true, ...}` y tiempos de respuesta < 200ms.
* **Riesgos:** Falla de conexión al pool de Postgres si las credenciales en `.env` no coinciden.

---

### FASE 3: Pantallas y Reproducción (TV Engine)
* **Objetivo:** Comprobar que el motor de visualización (`/tv`) reproduce correctamente los diferentes formatos (video, imagen, iframe Power BI, YouTube) en bucle.
* **Casos Asociados:** `TC-004`, `TC-005`.
* **Evidencia Necesaria:** Observación del comportamiento de video looping, transiciones de imagen temporizadas y logs de consola del navegador.
* **Criterio de Aprobación:** 0 bloqueos de pantalla; transiciones fluidas sin parpadeos negros superiores a 500ms.
* **Riesgos:** Archivos 404 que desencadenen saltos repetitivos o errores no capturados en el player.

---

### FASE 4: Playlists y Programación
* **Objetivo:** Evaluar el comportamiento del filtro de días de la semana y el impacto de los turnos horarios (`start_time`/`end_time`).
* **Casos Asociados:** `TC-003`.
* **Evidencia Necesaria:** Comparativa del contenido devuelto por la API en distintos horarios del día y días de la semana.
* **Criterio de Aprobación:** Claridad definitiva sobre si la omisión del filtro horario es un requerimiento de negocio o un defecto que deba ser registrado.
* **Riesgos:** Interpretación incorrecta de la intención original del diseño.

---

### FASE 5: PIN y Vinculación Remota (Pairing)
* **Objetivo:** Verificar el flujo completo de descubrimiento y asignación remota de pantallas nuevas sin interacción táctil física.
* **Casos Asociados:** `TC-006`, `TC-007`, `TC-008`.
* **Evidencia Necesaria:** Detección del PIN en `/admin/register`, recepción del evento `command:assign_profile` en el cliente y guardado en `localStorage`.
* **Criterio de Aprobación:** La TV comienza a reproducir en menos de 2 segundos tras presionar "Asignar y Activar" en el admin.
* **Riesgos:** Pérdida de paquetes WebSocket si la TV y el backend no sincronizan el namespace `/control`.

---

### FASE 6: Controles Remotos en Tiempo Real
* **Objetivo:** Validar que los comandos de reproducción, volumen, recarga y campanilla sonora se ejecutan instantáneamente.
* **Casos Asociados:** `TC-011`, `TC-012`, `TC-013`.
* **Evidencia Necesaria:** Cambio en el estado de reproducción (`video.paused`), alteración del nivel de volumen y sonido emitido por el oscilador Web Audio API.
* **Criterio de Aprobación:** Latencia extremo a extremo menor a 500ms entre el clic en el admin y la acción en la pantalla.
* **Riesgos:** Silenciado forzado por el navegador si la pantalla no cuenta con la política de autoplay configurada.

---

### FASE 7: Transmisión Prioritaria (Broadcast Override)
* **Objetivo:** Probar la interrupción inmediata de la programación normal para comunicados urgentes y su posterior reanudación.
* **Casos Asociados:** `TC-009`, `TC-010`.
* **Evidencia Necesaria:** Montaje del banner "EN VIVO" en todas las pantallas receptoras, suspensión de temporizadores de playlist y retorno al punto exacto al finalizar.
* **Criterio de Aprobación:** 100% de las pantallas conectadas acatan la orden simultáneamente; ninguna pantalla queda en estado inconsistente.
* **Riesgos:** Fuga de memoria si múltiples transmisiones consecutivas no limpian los timers de Node.js (`clearTimeout`).

---

### FASE 8: Multimedia y Subidas de Archivos
* **Objetivo:** Validar la carga de videos e imágenes, el cálculo de duración mediante FFprobe y el registro en el catálogo.
* **Casos Asociados:** `TC-014`, `TC-015`, `TC-016`, `TC-017`.
* **Evidencia Necesaria:** Archivo creado físicamente en `/app/media/`, metadatos en tabla `nexus_tv.content` y respuesta HTTP 201.
* **Criterio de Aprobación:** Duración exacta calculada para videos MP4; imágenes registradas con su tiempo configurado.
* **Riesgos:** Saturación de disco o timeouts si se suben archivos muy pesados.

---

### FASE 9: Errores, Resiliencia y Edge Cases
* **Objetivo:** Someter al sistema a desconexiones, reinicios de backend, caídas de red y listas vacías.
* **Casos Asociados:** `TC-018`, `TC-019`.
* **Evidencia Necesaria:** Reconexión automática de Socket.IO, persistencia de credenciales en cliente y ausencia de crash en el servidor.
* **Criterio de Aprobación:** El sistema se auto-recupera sin requerir recargas manuales por parte del usuario.
* **Riesgos:** Pérdida del estado de broadcast volátil en memoria tras reinicio del proceso Node.js.

---

### FASE 10: Testing Visual y Responsividad
* **Objetivo:** Evaluar la presentación visual de la consola administrativa y del reproductor en diversos viewports.
* **Casos Asociados:** `TC-020`.
* **Evidencia Necesaria:** Inspección de scroll horizontal, legibilidad de tipografía, contraste de badges y consistencia de componentes.
* **Criterio de Aprobación:** Identificación y documentación de todas las anomalías visuales en `risk-register.md` sin alterar los estilos.
* **Riesgos:** Ninguno (prueba visual pasiva).

---

### FASE 11: Regresión y Cierre de Auditoría
* **Objetivo:** Consolidar todos los resultados, verificar que ningún test alteró datos sensibles y emitir el informe final de QA.
* **Casos Asociados:** Revisión cruzada de todos los `TC-001` a `TC-020`.
* **Evidencia Necesaria:** Matriz de casos de prueba actualizada con estados finales (`Aprobado` / `Fallido`) y tickets abiertos en `11-incidents/`.
* **Criterio de Aprobación:** 100% de los casos prioritarios ejecutados y clasificados.
* **Riesgos:** Dejar datos de prueba basura en la base de datos de producción.
