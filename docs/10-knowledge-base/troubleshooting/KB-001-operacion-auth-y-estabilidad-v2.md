# KB-001 — Operación Segura de Consola Admin, Kioskos y Reproducción Continua

## Cuándo usar esta guía
Cuando un operador no pueda iniciar sesión en `/admin`, cuando una pantalla no reproduzca contenido programado, o cuando se sospeche saturación por medios faltantes (HTTP 404).

## Diagnóstico
1. **Acceso Denegado (HTTP 401):** Verificar si la cabecera `Authorization: Bearer <token>` está presente en la petición a la API. Si expiró (vida útil 8h), re-autenticarse en `/login`.
2. **Turnos de Playlist Vacíos:** Confirmar si la hora del servidor coincide con las franjas horarias `start_time` y `end_time` en `nexus_tv.playlist_content`. Fuera de turno, la API responderá legítimamente `total: 0`.
3. **Carga Multimedia Faltante:** Si un archivo local devuelve 404, el reproductor aplica un backoff defensivo de 2 segundos antes de avanzar al siguiente ítem.

## Solución paso a paso
1. **Para Administradores:**
   - Acceder a `http://localhost:28080/admin`.
   - Ingresar con credenciales corporativas (`p1_principal`).
   - Para cerrar sesión de forma forzada y limpiar storage, pulsar el botón "Cerrar Sesión" en la barra superior.
2. **Para Pantallas Kiosk (Smart TV):**
   - Lanzar el navegador Kiosk hacia `http://localhost:28080/tv?uuid=<UUID>`.
   - Las pantallas no requieren credenciales ni token JWT (operan desatendidas por UUID activo).
3. **Para Subida de Archivos Pesados:**
   - El límite perimetral en Nginx y backend está homologado en **500 MB**.

## Resultado esperado
- Acceso a la consola únicamente con credenciales válidas.
- Pantallas reproduciendo de forma continua sin parpadeos ni congelamientos.
- Cero advertencias CORS en la consola del navegador.

## Qué no hacer
- ❌ No deshabilitar el middleware `authMiddleware` en `nx_tv.js`.
- ❌ No restaurar el comodín `cors({ origin: '*' })`.
- ❌ No remover el temporizador de backoff de 2s en `TVPlayer.jsx`.

## Rollback
En caso de bloqueo crítico de acceso o problemas en producción:
- Ejecutar: `git checkout v2.0.0`
- Reiniciar contenedores: `docker compose down && docker compose up -d`

## Origen
Resuelve y documenta la remediación de `BUG-001`, `BUG-002`, `BUG-003`, `BUG-004` y `BUG-005` (Release v2.0.1).
