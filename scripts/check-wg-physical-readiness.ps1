$ErrorActionPreference = 'Stop'

Write-Host 'DataPlus physical WireGuard readiness check'

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  Write-Host 'FAIL: wsl.exe is unavailable'
  exit 1
}
Write-Host 'PASS: wsl.exe is available'

$wg = Get-Command wg.exe -ErrorAction SilentlyContinue
if ($wg) {
  Write-Host 'PASS: Windows wg.exe is available'
} else {
  Write-Host 'INFO: wg.exe is not on PATH; use the official WireGuard app or add the tools directory'
}

$distribution = & wsl.exe --list --quiet 2>$null
$ubuntu = $distribution | Where-Object { $_.Trim() -eq 'Ubuntu' }
if (-not $ubuntu) {
  Write-Host 'FAIL: Ubuntu WSL distribution is unavailable'
  exit 1
}
Write-Host 'PASS: Ubuntu WSL distribution is available'

& wsl.exe --distribution Ubuntu -- bash -lc 'command -v wg >/dev/null'
if ($LASTEXITCODE -ne 0) {
  Write-Host 'FAIL: wireguard-tools is unavailable inside Ubuntu'
  exit 1
}
Write-Host 'PASS: wireguard-tools is available inside Ubuntu'

$interfaceExists = $false
try {
  $interfaceState = (& wsl.exe --distribution Ubuntu -- bash -lc 'ip link show dev wgdpdev0 >/dev/null 2>&1 && echo running || echo stopped' 2>$null | Out-String).Trim()
} catch {
  $interfaceState = 'unknown'
}
if ($interfaceState -eq 'running') {
  $interfaceExists = $true
  Write-Host 'INFO: wgdpdev0 is currently running'
} elseif ($interfaceState -eq 'unknown') {
  Write-Host 'INFO: wgdpdev0 state could not be confirmed'
} else {
  Write-Host 'PASS: wgdpdev0 is currently stopped'
}

Write-Host 'LAB: no Internet forwarding, NAT or Windows route is modified by this check'
Write-Host 'NEXT: provision through the authenticated native enrollment route with a public key only'
exit 0
