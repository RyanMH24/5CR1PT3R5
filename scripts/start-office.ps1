<#
.SYNOPSIS
    Opens 5CR1PT3R5 in your browser, starting the local host first if it isn't running.

.DESCRIPTION
    Used by the "5CR1PT3R5" Desktop shortcut. If the host already answers on the port, this
    just opens the page. Otherwise it starts `office ui` in this window; close the window (or
    press Ctrl+C) to stop the host. Agents already working keep going either way.

.PARAMETER Port
    Port for the local host. Defaults to 4777.

.EXAMPLE
    .\scripts\start-office.ps1
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4777
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port/"

function Test-OfficeHost {
    try {
        $null = Invoke-WebRequest -Uri "${url}api/snapshot" -UseBasicParsing -TimeoutSec 2
        return $true
    }
    catch {
        return $false
    }
}

if (Test-OfficeHost) {
    Start-Process $url
    return
}

# A shortcut starts with a minimal environment; find Node even if PATH is stale.
$node = $null
$command = Get-Command node -ErrorAction SilentlyContinue
if ($command) { $node = $command.Source }
if (-not $node) {
    $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $candidate) { $node = $candidate }
}
if (-not $node) {
    Write-Host 'Node.js was not found. Install it with: winget install OpenJS.NodeJS.LTS' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$Host.UI.RawUI.WindowTitle = "5CR1PT3R5 host ($url)"
Write-Host "Starting 5CR1PT3R5 at $url" -ForegroundColor Green
Write-Host 'Keep this window open while you use the office. Close it to stop the host.'
& $node (Join-Path $root 'bin\office.mjs') ui --port $Port
