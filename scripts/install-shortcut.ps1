<#
.SYNOPSIS
    Puts a "5CR1PT3R5" shortcut on your Desktop that opens the office in your browser.

.EXAMPLE
    .\scripts\install-shortcut.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'start-office.ps1'
$desktop = [Environment]::GetFolderPath('Desktop') # follows OneDrive-redirected Desktops
$path = Join-Path $desktop '5CR1PT3R5.lnk'
$legacy = Join-Path $desktop 'Agent Office.lnk' # the project's previous name

if ((Test-Path $legacy) -and $PSCmdlet.ShouldProcess($legacy, 'Remove old shortcut')) {
    Remove-Item $legacy
}

if ($PSCmdlet.ShouldProcess($path, 'Create shortcut')) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$launcher`""
    $shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $shortcut.Description = 'Open 5CR1PT3R5 (starts the local host if needed)'
    $shortcut.IconLocation = Join-Path $PSScriptRoot 'windows\5CR1PT3R5.ico'
    $shortcut.Save()
    Write-Host "Created $path" -ForegroundColor Green
}
