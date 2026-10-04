<#
.SYNOPSIS
    Zips 5CR1PT3R5 so you can copy it to a Mac.

.DESCRIPTION
    Leaves out node_modules (the Mac installs its own) and .office (this PC's jobs, logs and
    desk locks). Uses the tar.exe that ships with Windows because Compress-Archive in Windows
    PowerShell writes backslash paths that macOS unpacks as odd file names.

    On the Mac, unzip it into a Projects folder (agents' work goes in Projects/Agents Work next
    to it), then run:  zsh scripts/install.zsh  and  zsh scripts/install-app.zsh

.PARAMETER OutFile
    Where to write the zip. Defaults to 5CR1PT3R5-mac.zip on your Desktop.

.EXAMPLE
    .\scripts\pack-mac.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$OutFile = (Join-Path ([Environment]::GetFolderPath('Desktop')) '5CR1PT3R5-mac.zip')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$name = Split-Path -Leaf $root
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tar)) { throw "tar.exe was not found at $tar (it ships with Windows 10 1803 and later)." }

# zsh refuses scripts with Windows line endings ("bad interpreter: /usr/bin/env zsh^M").
$unix = Get-ChildItem -Path (Join-Path $root 'scripts\*.zsh'), (Join-Path $root 'bin\*.mjs'), (Join-Path $root 'completions\_office')
$crlf = @($unix | Where-Object { [IO.File]::ReadAllText($_.FullName).Contains("`r`n") })
if ($crlf.Count -gt 0) {
    throw "These files have Windows line endings and won't run on a Mac; convert them to LF first:`n  $($crlf.FullName -join "`n  ")"
}

$OutFile = [IO.Path]::GetFullPath($OutFile)
if ($PSCmdlet.ShouldProcess($OutFile, "Zip $name for macOS")) {
    if (Test-Path $OutFile) { Remove-Item $OutFile }
    & $tar -a -c -f $OutFile -C (Split-Path -Parent $root) --exclude "$name/node_modules" --exclude "$name/.office" $name
    if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
    $size = '{0:N0} KB' -f ((Get-Item $OutFile).Length / 1KB)
    Write-Host "Created $OutFile ($size)" -ForegroundColor Green
    Write-Host 'Copy it to your Mac (iCloud Drive, OneDrive, Google Drive, a USB stick...), unzip it into a Projects folder, then run:'
    Write-Host "  cd ~/Projects/$name"
    Write-Host '  zsh scripts/install.zsh'
    Write-Host '  zsh scripts/install-app.zsh'
}
