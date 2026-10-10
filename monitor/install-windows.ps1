# Installs the V9D monitor as a background task that starts with Windows.
# Run from an Administrator PowerShell inside this folder:
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$taskName = 'V9D Monitor'

# 1. Node.js 22+
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.' }
$major = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Node.js 22 or newer is needed (found $(& node -v)). Install the LTS version from https://nodejs.org." }

# 2. Dependencies
Write-Host 'Installing dependencies...'
Push-Location $dir
& npm install --omit=dev --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
Pop-Location
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'data') | Out-Null

# 3. Background task: starts at boot, restarts if it crashes, log in data\monitor.log
Write-Host 'Registering background task...'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" monitor.js >> data\monitor.log 2>&1`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

try {
  $status = Invoke-RestMethod 'http://127.0.0.1:8787/api/status' -TimeoutSec 5
  Write-Host 'Monitor is running. Printers:' -ForegroundColor Green
  $status.printers.PSObject.Properties | ForEach-Object { Write-Host "  $($_.Name): $($_.Value.state)" }
} catch {
  Write-Host "Monitor did not answer yet - check $dir\data\monitor.log" -ForegroundColor Yellow
}

# 4. Make it reachable from your phone over Tailscale (HTTPS)
Write-Host 'Publishing on your Tailscale network...'
& tailscale serve --bg 8787
Write-Host ''
Write-Host 'Done. Open V9D on your iPhone -> 3D Printers -> bell icon -> Enable notifications.' -ForegroundColor Green
