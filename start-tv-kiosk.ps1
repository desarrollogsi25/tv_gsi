# ======================================================
# NEXUS TV ENTERPRISE — KIOSK MODE LAUNCHER FOR SMART TV / DISPLAYS
# ======================================================
# Este script inicia Chrome o Edge en modo Kiosk con la politica de
# reproduccion automatica de audio habilitada (--autoplay-policy=no-user-gesture-required).
# Esto permite que los comandos remotos de activacion de sonido (unmute, volume)
# funcionen de forma 100% remota sin requerir intervencion fisica ni clics en la pantalla.
# ======================================================

param (
    [string]$TargetUrl = "http://localhost:28080/tv",
    [string]$TvUuid = ""
)

Clear-Host
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    NEXUS TV — KIOSK DISPLAY & AUDIO AUTO-UNLOCK     " -ForegroundColor Cyan -BackgroundColor DarkBlue
Write-Host "======================================================" -ForegroundColor Cyan

if ($TvUuid -ne "") {
    if ($TargetUrl.Contains("?")) {
        $TargetUrl = "$TargetUrl&uuid=$TvUuid"
    } else {
        $TargetUrl = "$TargetUrl?uuid=$TvUuid"
    }
}

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
    Start-Process $TargetUrl
    exit
}

Write-Host " Navegador      : $BrowserPath" -ForegroundColor Green
Write-Host " Flags Kiosk    : --kiosk --autoplay-policy=no-user-gesture-required" -ForegroundColor Green
Write-Host ""
Write-Host "[+] Iniciando reproductor Nexus TV en pantalla completa con audio remoto desbloqueado..." -ForegroundColor Cyan

$UserDataDir = "$env:TEMP\nexus_tv_kiosk_profile"

$Arguments = @(
    "--kiosk",
    "--autoplay-policy=no-user-gesture-required",
    "--noerrdialogs",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
    "--disable-features=TranslateUI",
    "--user-data-dir=`"$UserDataDir`"",
    "`"$TargetUrl`""
)

Start-Process -FilePath $BrowserPath -ArgumentList ($Arguments -join " ")
Write-Host "[OK] Nexus TV Kiosk iniciado exitosamente." -ForegroundColor Green
