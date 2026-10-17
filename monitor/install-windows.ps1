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

# Trend Radar: Anthropic API key, stored only in this PC's config.json (never uploaded).
$cfgPath = Join-Path $dir 'config.json'
$cfg = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
if (-not $cfg.anthropicApiKey) {
  $key = Read-Host 'Paste your Anthropic API key for Trend Radar (or press Enter to skip)'
  if ($key.Trim()) {
    $cfg | Add-Member -NotePropertyName anthropicApiKey -NotePropertyValue $key.Trim() -Force
    $cfg | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding ascii
    Write-Host 'API key saved.'
  }
}

# Stop copies from an earlier install so the new ones can take over their ports.
foreach ($t in 'V9D Monitor', 'V9D Camera') { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*monitor.js*' } |
  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
Get-Process go2rtc -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# 3. Background task: starts at boot, restarts if it crashes, log in data\monitor.log
Write-Host 'Registering background task...'
# run-monitor.cmd restarts the monitor whenever it stops (crash, update), so the task itself never ends.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$dir\run-monitor.cmd`"" -WorkingDirectory $dir
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

# 4. Camera relay (go2rtc): pulls the printers' WebRTC camera streams on the local
#    network and re-serves them to the phone over Tailscale.
Write-Host 'Setting up camera relay...'
$camTask = 'V9D Camera'
$g2rDir = Join-Path $dir 'go2rtc'
$g2rExe = Join-Path $g2rDir 'go2rtc.exe'
New-Item -ItemType Directory -Force -Path $g2rDir | Out-Null
if (-not (Test-Path $g2rExe)) {
  $zip = Join-Path $env:TEMP 'go2rtc_win64.zip'
  Invoke-WebRequest 'https://github.com/AlexxIT/go2rtc/releases/download/v1.9.14/go2rtc_win64.zip' -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $g2rDir -Force
  Remove-Item $zip
}
$printers = Invoke-RestMethod 'https://v9dproducts.github.io/v9d/printers.json'
$yaml = @('api:', '  listen: "127.0.0.1:1984"', 'rtsp:', '  listen: ""', 'streams:')
foreach ($p in $printers) {
  if ($p.camera -eq 'creality') { $yaml += "  $($p.id): webrtc:http://$($p.ip):8000/call/webrtc_local#format=creality" }
}
Set-Content -Path (Join-Path $g2rDir 'go2rtc.yaml') -Value $yaml -Encoding ascii

$camAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$dir\run-camera.cmd`"" -WorkingDirectory $g2rDir
Unregister-ScheduledTask -TaskName $camTask -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $camTask -Action $camAction -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $camTask

# 5. Make both reachable from your phone over Tailscale (HTTPS)
Write-Host 'Publishing on your Tailscale network...'
& tailscale serve --bg 8787
& tailscale serve --bg --https=8443 1984
Write-Host ''
Write-Host 'Done. Open V9D on your iPhone -> 3D Printers. Bell icon = notifications, Camera = live view.' -ForegroundColor Green
