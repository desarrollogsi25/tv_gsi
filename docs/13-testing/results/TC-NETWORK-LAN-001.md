# Nexus TV Enterprise — Caso de Prueba TC-NETWORK-LAN-001

> **Documento:** TC-NETWORK-LAN-001
> **Título:** Análisis de Compatibilidad de Red, Acceso LAN Remoto y Configuración de Orígenes Permitidos (CORS / WebSockets)
> **Fecha de Ejecución:** 2026-10-09
> **Tester / Ingeniero:** Senior Software Engineer & Security Auditor
> **Normativas:** ISO/IEC 27001:2022 (Control de Acceso a Redes), OWASP Security Guidelines
> **Resultado del Análisis:** 🟡 **DOCUMENTADO / REQUISITOS DEFINIDOS CON EVIDENCIA**

---

## 1. Contexto y Objetivos

El valor predeterminado del lanzador Kiosk apunta a `http://localhost:28080/tv`, el cual es exclusivamente funcional cuando el navegador se ejecuta en el mismo host que aloja los contenedores de Docker.
Para operar un televisor físico inteligente (Smart TV), mini-PC dedicada o pantalla en red local, el dispositivo debe conectarse a través de la dirección IP o FQDN de la red local del servidor (ej. `http://192.168.1.150:28080/tv`).

Este caso de prueba evalúa:
1. El parámetro `-TargetUrl` del lanzador Kiosk.
2. El impacto de `ALLOWED_ORIGINS` en el backend Express y en el servidor de WebSockets Socket.IO.
3. El riesgo de utilizar políticas inseguras (`*` / comodín).
4. El procedimiento operativo formal para desplegar pantallas en la LAN corporativa.

---

## 2. Inspección Técnica de la Configuración Existente

### 2.1. Configuración de Orígenes en `docker-compose.yml`
```yaml
backend:
  environment:
    - ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:28080,http://127.0.0.1:28080}
```

### 2.2. Implementación de CORS y Socket.IO en `nx_tv.js`
```javascript
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:28080,http://127.0.0.1:28080')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

// CORS HTTP
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origen ${origin} no permitido por CORS`));
    },
    credentials: true
}));

// Socket.IO
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    }
});
```

### 2.3. Evaluación de Seguridad
- **Criterio Estricto:** La arquitectura rechaza orígenes no declarados explícitamente en `ALLOWED_ORIGINS`.
- **Riesgo Identificado (RSK-025):** Si un administrador conecta una TV física apuntando al navegador a `http://192.168.1.50:28080/tv`, el navegador cliente enviará el encabezado `Origin: http://192.168.1.50:28080`. Si dicha IP no ha sido añadida a `ALLOWED_ORIGINS` en el archivo `.env`, las solicitudes a `/api/tv/login`, `/api/tv/heartbeat` y la conexión WebSocket hacia `/control` serán rechazadas con error de CORS.
- **Prohibición Expresa:** Bajo ninguna circunstancia se debe recurrir a `ALLOWED_ORIGINS=*`, ya que `credentials: true` es incompatible con comodines y habilitaría vectores de falsificación de peticiones en sitios cruzados (CSRF / WebSocket Hijacking).

---

## 3. Procedimiento Oficial para Configuración en Red Local (LAN)

Para poner en producción un televisor físico o pantalla en la red corporativa:

### Paso 1: Determinar la IP local estática o nombre de dominio del servidor host
Ejecutar en el servidor host:
```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*vEthernet*" -and $_.IPAddress -notlike "127.*" } | Select-Object IPAddress, InterfaceAlias
```
*Ejemplo obtenido:* `192.168.1.100`.

### Paso 2: Actualizar el archivo `.env` del servidor
Agregar la IP o dominio del host a `ALLOWED_ORIGINS` (separado por comas, sin espacios superfluos):
```env
ALLOWED_ORIGINS=http://localhost:28080,http://127.0.0.1:28080,http://192.168.1.100:28080
```

### Paso 3: Aplicar configuración sin degradar datos
Reiniciar el backend para cargar las nuevas variables:
```powershell
docker compose up -d backend
```

### Paso 4: Lanzamiento en la Pantalla Remota / TV
- **Desde la TV o Smart Display:** Abrir el navegador en `http://192.168.1.100:28080/tv`.
- **Desde una estación Windows Kiosk remota:**
  ```cmd
  start-tv-kiosk.cmd -TargetUrl http://192.168.1.100:28080/tv
  ```

### Paso 5: Verificación del Flujo Completo
1. **Acceso Web:** Comprobar que el navegador descarga el HTML y assets estáticos desde el puerto `28080`.
2. **Presentación de PIN:** La pantalla entra en modo espera y muestra `#PIN_XXXX`.
3. **Detección en Consola de Administración:** En `http://192.168.1.100:28080/admin/register`, la pantalla aparece listada con su IP de la LAN y el PIN correspondiente.
4. **Vinculación:** El administrador asigna el perfil deseado.
5. **Transmisión y Telemetría:** La pantalla comienza la reproducción de la playlist y emite heartbeats periódicos cada 15 segundos sin errores de red.
