# ======================================================
# NEXUS TV ENTERPRISE (GSI) - LOCAL DOCKER DEPLOYMENT TOOL
# ======================================================

Clear-Host

$Cyan = "Cyan"
$Green = "Green"
$Yellow = "Yellow"
$Red = "Red"
$White = "White"

Write-Host "======================================================" -ForegroundColor $Cyan
Write-Host "    NEXUS TV (GSI) - LOCAL DOCKER ENVIRONMENT         " -ForegroundColor $Cyan -BackgroundColor DarkBlue
Write-Host "======================================================" -ForegroundColor $Cyan
Write-Host " Herramienta interactiva para pruebas en Docker Local (DB + API + Web)"
Write-Host " [Puertos Lejanos Aislados: DB=25432, API=23002, Web=28080]" -ForegroundColor $Yellow
Write-Host ""

# Resolver directorio raiz de Nexus TV dinamicamente
if (Test-Path "$PSScriptRoot\docker-compose.yml") {
    $ProjectRoot = $PSScriptRoot
} elseif (Test-Path "$PSScriptRoot\tv_gsi\docker-compose.yml") {
    $ProjectRoot = (Resolve-Path "$PSScriptRoot\tv_gsi").Path
} elseif (Test-Path "$PSScriptRoot\..\docker-compose.yml") {
    $ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
} elseif (Test-Path "$PSScriptRoot\..\tv_gsi\docker-compose.yml") {
    $ProjectRoot = (Resolve-Path "$PSScriptRoot\..\tv_gsi").Path
} else {
    $ProjectRoot = $PSScriptRoot
}
Set-Location $ProjectRoot

# Detectar archivo compose disponible (docker-compose.local.yml o docker-compose.yml)
$ComposeFile = "docker-compose.local.yml"
if (-not (Test-Path $ComposeFile)) {
    $ComposeFile = "docker-compose.yml"
}

if (-not (Test-Path $ComposeFile)) {
    Write-Host "[-] No se encontro el archivo $ComposeFile en $ProjectRoot" -ForegroundColor $Red
    Exit
}

Write-Host "Selecciona la accion a ejecutar:" -ForegroundColor $White
Write-Host " 1) Construir y Levantar Entorno Local Completo (DB + API + Web)" -ForegroundColor $Green
Write-Host " 2) Ver Logs en Tiempo Real de Nexus TV" -ForegroundColor $Cyan
Write-Host " 3) Ver Estado de Contenedores Locales (PS)" -ForegroundColor $White
Write-Host " 4) Probar Salud y Estado de Servicios (DB + API + Web)" -ForegroundColor $Yellow
Write-Host " 5) Reiniciar Contenedores de Nexus TV (Restart)" -ForegroundColor $Cyan
Write-Host " 6) Detener y Limpiar Entorno Local (Down)" -ForegroundColor $Red
Write-Host " 7) Abrir Reproductor Smart TV en Modo Kiosk (Audio Remoto Habilitado)" -ForegroundColor $Green
Write-Host " 8) Salir"
Write-Host ""

$Option = Read-Host "Opcion [1-8]"

if ($Option -eq "1") {
    Write-Host ""
    # Asegurar archivo .env con credenciales seguras si no existe
    if (-not (Test-Path "$ProjectRoot\.env") -and (Test-Path "$ProjectRoot\.env.example")) {
        Write-Host "[!] Archivo .env no encontrado. Generando .env con secretos criptograficos seguros..." -ForegroundColor $Yellow
        $envContent = Get-Content "$ProjectRoot\.env.example" -Raw
        $randomBytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
        $randomSecret = [System.BitConverter]::ToString($randomBytes).Replace("-", "").ToLower()
        $dbBytes = New-Object byte[] 16
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($dbBytes)
        $randomDbPass = [System.BitConverter]::ToString($dbBytes).Replace("-", "").ToLower()
        $envContent = $envContent.Replace("replace_with_a_random_secret_of_at_least_32_bytes", $randomSecret)
        $envContent = $envContent.Replace("replace_with_a_unique_database_password", $randomDbPass)
        [System.IO.File]::WriteAllText("$ProjectRoot\.env", $envContent, [System.Text.Encoding]::UTF8)
        Write-Host "[OK] Archivo .env inicializado con secretos unicos generados criptograficamente." -ForegroundColor Green
    }

    Write-Host "[+] Compilando y levantando contenedores locales en puertos aislados (DB:25432, API:23002, Web:28080)..." -ForegroundColor $Yellow
    docker compose -f $ComposeFile up --build -d
    Write-Host ""
    Write-Host "[OK] Entorno local iniciado exitosamente." -ForegroundColor $Green
    Write-Host "==================================================================" -ForegroundColor $Cyan
    Write-Host "  Database PostgreSQL (v17)      : localhost:25432 (nexus_tv)" -ForegroundColor $Green
    Write-Host "  Backend API & Sockets (Node 20): http://localhost:23002" -ForegroundColor $Green
    Write-Host "  Frontend Web SPA (Nginx)       : http://localhost:28080" -ForegroundColor $Green
    Write-Host "  Digital Signage Player (TV)    : http://localhost:28080/tv" -ForegroundColor $Cyan
    Write-Host "  Admin Control Center           : http://localhost:28080/admin" -ForegroundColor $Cyan
    Write-Host "  Health Check / Status (API)    : http://localhost:23002/api/status" -ForegroundColor $Yellow
    Write-Host "  Health Check (Web SPA)         : http://localhost:28080/" -ForegroundColor $Yellow
    Write-Host "==================================================================" -ForegroundColor $Cyan
}
elseif ($Option -eq "2") {
    Write-Host ""
    Write-Host "[+] Transmitiendo logs de Nexus TV (Ctrl + C para salir)..." -ForegroundColor $Cyan
    docker compose -f $ComposeFile logs -f --tail=100
}
elseif ($Option -eq "3") {
    Write-Host ""
    Write-Host "[+] Estado de los contenedores locales de Nexus TV:" -ForegroundColor $Yellow
    docker compose -f $ComposeFile ps
}
elseif ($Option -eq "4") {
    Write-Host ""
    Write-Host "[+] 1. Consultando estado de Base de Datos PostgreSQL (tv-db)..." -ForegroundColor $Yellow
    try {
        $dbReady = docker exec tv-db pg_isready -U tv -d nexus_tv 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Base de datos activa: $dbReady" -ForegroundColor $Green
            $tableCount = (docker exec tv-db psql -U tv -d nexus_tv -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'nexus_tv';" 2>&1).Trim()
            $screensCount = (docker exec tv-db psql -U tv -d nexus_tv -t -c "SELECT count(*) FROM nexus_tv.tv_screens;" 2>&1).Trim()
            $playlistsCount = (docker exec tv-db psql -U tv -d nexus_tv -t -c "SELECT count(*) FROM nexus_tv.playlists;" 2>&1).Trim()
            Write-Host "  [i] Tablas estructuradas activas en schema 'nexus_tv': $tableCount tablas" -ForegroundColor $Cyan
            Write-Host "  [i] Pantallas registradas en BD: $screensCount | Playlists: $playlistsCount" -ForegroundColor $Cyan
        } else {
            Write-Host "  [-] PostgreSQL no respondio: $dbReady" -ForegroundColor $Red
        }
    }
    catch {
        Write-Host "  [-] Error al consultar tv-db: $($_.Exception.Message)" -ForegroundColor $Red
    }

    Write-Host ""
    Write-Host "[+] 2. Consultando salud de API Backend (http://localhost:23002/api/status)..." -ForegroundColor $Yellow
    try {
        $responseApi = Invoke-RestMethod -Uri "http://localhost:23002/api/status" -Method Get -TimeoutSec 5
        Write-Host "  [OK] Respuesta del servidor API: $($responseApi | ConvertTo-Json -Compress)" -ForegroundColor $Green
    }
    catch {
        Write-Host "  [-] El servicio API no respondio o ocurrio un error: $($_.Exception.Message)" -ForegroundColor $Red
    }

    Write-Host ""
    Write-Host "[+] 3. Consultando salud de Web Frontend (http://localhost:28080/)..." -ForegroundColor $Yellow
    try {
        $responseWeb = Invoke-WebRequest -Uri "http://localhost:28080/" -Method Get -TimeoutSec 5 -UseBasicParsing
        Write-Host "  [OK] Servidor Web Nginx respondiendo con codigo HTTP $($responseWeb.StatusCode)" -ForegroundColor $Green
    }
    catch {
        Write-Host "  [-] El servicio Web no respondio o ocurrio un error: $($_.Exception.Message)" -ForegroundColor $Red
    }
}
elseif ($Option -eq "5") {
    Write-Host ""
    Write-Host "[+] Reiniciando contenedores de Nexus TV..." -ForegroundColor $Yellow
    docker compose -f $ComposeFile restart
    Write-Host "[OK] Contenedores reiniciados correctamente." -ForegroundColor $Green
}
elseif ($Option -eq "6") {
    Write-Host ""
    Write-Host "[+] Deteniendo contenedores locales de Nexus TV (preservando volumen de base de datos)..." -ForegroundColor $Yellow
    docker compose -f $ComposeFile down --remove-orphans
    Write-Host "[OK] Entorno local detenido exitosamente (los datos de PostgreSQL se conservan intactos)." -ForegroundColor $Green
}
elseif ($Option -eq "7") {
    Write-Host ""
    $TvId = Read-Host "Ingresa UUID de la TV (Enter para abrir pantalla sin vincular o con perfil guardado)"
    & "$ProjectRoot\start-tv-kiosk.ps1" -TvUuid $TvId
}
else {
    Write-Host "Operacion finalizada." -ForegroundColor $Yellow
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor $Cyan
