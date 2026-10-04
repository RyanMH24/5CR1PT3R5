<#
.SYNOPSIS
    Installs the `office` command and its tab completion for PowerShell.

.DESCRIPTION
    Links the package globally with npm (creating office.ps1 / office.cmd shims on your PATH),
    then dot-sources the completion script from your PowerShell profile. Safe to run again.

.EXAMPLE
    .\scripts\install.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$completion = Join-Path $root 'completions\office.ps1'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22.18+ is required. Install it with: winget install OpenJS.NodeJS.LTS'
}

Push-Location $root
try {
    if ($PSCmdlet.ShouldProcess($root, 'npm install && npm link')) {
        npm install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
        npm link --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'npm link failed' }
    }
}
finally {
    Pop-Location
}

$line = ". `"$completion`""
$profileText = if (Test-Path $PROFILE) { Get-Content $PROFILE -Raw } else { '' }
if ($profileText -notlike "*$completion*") {
    if ($PSCmdlet.ShouldProcess($PROFILE, 'Add 5CR1PT3R5 tab completion')) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PROFILE) | Out-Null
        Add-Content -Path $PROFILE -Value "`n# 5CR1PT3R5 tab completion`n$line" -Encoding utf8
        Write-Host "Added tab completion to $PROFILE"
    }
}
else {
    Write-Verbose 'Tab completion already in profile.'
}

Write-Host "`nInstalled. Open a new PowerShell window, then try:" -ForegroundColor Green
Write-Host '  office doctor'
Write-Host '  office roster'
