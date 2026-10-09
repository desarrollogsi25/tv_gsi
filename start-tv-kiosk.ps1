# ======================================================
# NEXUS TV ENTERPRISE - KIOSK MODE LAUNCHER FOR SMART TV / DISPLAYS
# ======================================================
# Este script inicia Chrome o Edge en modo Kiosk con la politica de
# reproduccion automatica de audio habilitada (--autoplay-policy=no-user-gesture-required).
# Esto permite que los comandos remotos de activacion de sonido (unmute, volume)
# funcionen de forma 100% remota sin requerir intervencion fisica ni clics en la pantalla.
# Compatible con Windows PowerShell 5.1 y PowerShell Core (pwsh 7+).
# ======================================================

param (
    [string]$TargetUrl = "http://localhost:28080/tv",
    [string]$TvUuid = "",
    [switch]$NewProfile,
    [string]$ProfileId = ""
)

Clear-Host
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    NEXUS TV - KIOSK DISPLAY & AUDIO AUTO-UNLOCK     " -ForegroundColor Cyan -BackgroundColor DarkBlue
Write-Host "======================================================" -ForegroundColor Cyan

# Determinacion de modo y directorio de perfil
if ($NewProfile -or ($ProfileId -ne "")) {
    if ($ProfileId -eq "") {
        $ProfileId = "test_" + (Get-Date -Format "yyyyMMdd_HHmmss")
    }
    $UserDataDir = Join-Path $env:TEMP ("nexus_tv_kiosk_" + $ProfileId)
    $RunMode = "Simulacion de TV Nueva (Perfil Limpio Aislado: $ProfileId)"
} else {
    $UserDataDir = Join-Path $env:TEMP "nexus_tv_kiosk_profile"
    $RunMode = "Normal (Perfil Persistente)"
}

if ($TvUuid -ne "") {
    if ($TargetUrl.Contains("?")) {
        $TargetUrl = "$TargetUrl&uuid=$TvUuid"
    } else {
        $TargetUrl = "$TargetUrl?uuid=$TvUuid"
    }
}

Write-Host " Modo Kiosk     : $RunMode" -ForegroundColor White
Write-Host " Perfil Usuario : $UserDataDir" -ForegroundColor White
Write-Host " URL de destino : $TargetUrl" -ForegroundColor Yellow

# Buscar ejecutables de Chrome o Edge
$Browsers = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

$BrowserPath = $null
foreach ($path in $Browsers) {
    if (Test-Path $path) {
        $BrowserPath = $path
        break
    }
}

if (-not $BrowserPath) {
    Write-Host "[-] No se encontro Google Chrome ni Microsoft Edge instalado en las rutas predeterminadas." -ForegroundColor Red
    Write-Host "[!] Abriendo con el navegador por defecto del sistema..." -ForegroundColor Yellow
    Write-Host "[!] Advertencia: El navegador por defecto puede no ejecutar flags Kiosk ni desbloqueo de audio." -ForegroundColor Yellow
    try {
        Start-Process $TargetUrl
        Write-Host "[OK] URL enviada al navegador predeterminado del sistema." -ForegroundColor Green
    } catch {
        Write-Host "[-] Error al invocar el navegador predeterminado: $($_.Exception.Message)" -ForegroundColor Red
    }
    exit 0
}

Write-Host " Navegador      : $BrowserPath" -ForegroundColor Green
Write-Host " Flags Kiosk    : --kiosk --autoplay-policy=no-user-gesture-required" -ForegroundColor Green
Write-Host ""
Write-Host "[+] Iniciando reproductor Nexus TV en pantalla completa con audio remoto desbloqueado..." -ForegroundColor Cyan

$Arguments = @(
    "--kiosk",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--noerrdialogs",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
    "--disable-features=TranslateUI",
    "--user-data-dir=$UserDataDir",
    $TargetUrl
)

try {
    $proc = Start-Process -FilePath $BrowserPath -ArgumentList $Arguments -PassThru -ErrorAction Stop
    Start-Sleep -Milliseconds 800
    if ($proc -and -not $proc.HasExited) {
        Write-Host "[OK] Proceso del navegador Kiosk iniciado correctamente (PID: $($proc.Id))." -ForegroundColor Green
    } elseif ($proc -and $proc.HasExited) {
        Write-Host "[-] El proceso del navegador finalizo de forma inmediata tras el inicio (ExitCode: $($proc.ExitCode))." -ForegroundColor Red
    } else {
        Write-Host "[OK] Nexus TV Kiosk iniciado exitosamente." -ForegroundColor Green
    }
} catch {
    Write-Host "[-] Error al iniciar el proceso del navegador: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
