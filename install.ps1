# Tersio installer for Windows: bootstraps the global CLI, then runs the main
# `tersio install` in the same pass. It mirrors install.sh step for step, so the
# two files describe one install. Usage from PowerShell:
#   irm https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.ps1))) --npm
#
# Package-manager routing (mirrors install.sh):
#   default        bun when available, else npm
#   --bun          force the bun lane
#   --npm          force the npm lane
#   --ref <ref>    install a tag/branch/commit from a git clone instead of the
#                  registry (needs git); pairs with either lane
#   -r <ref>       shorthand for --ref
#
# A piped install cannot ask the menus, so it passes --yes and uses the defaults.
# Run the script with its own arguments to get the scope and Combo preset menus.

$ErrorActionPreference = 'Stop'

$Repo = 'KurutoDenzeru/tersio'
$Package = '@krtclcdy/tersio'
$Mode = ''
$Ref = ''
$Forward = [System.Collections.Generic.List[string]]::new()

for ($i = 0; $i -lt $args.Count; $i++) {
  switch -Wildcard ($args[$i]) {
    '--bun' { $Mode = 'bun' }
    '--npm' { $Mode = 'npm' }
    '--ref' { $Ref = $args[++$i] }
    '-r' { $Ref = $args[++$i] }
    '--ref=*' { $Ref = $args[$i].Substring(6) }
    default { $Forward.Add($args[$i]) }
  }
}

function Test-Command([string]$name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Install-FromRef([string]$mgr) {
  if (-not (Test-Command 'git')) { throw 'tersio installer: git is required for --ref' }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("tersio-" + [System.Guid]::NewGuid().ToString('N'))
  git clone --depth 1 --branch $Ref "https://github.com/$Repo.git" $tmp *> $null
  if ($LASTEXITCODE -ne 0) {
    git clone "https://github.com/$Repo.git" $tmp
    git -C $tmp checkout $Ref
  }
  Write-Host "Installing tersio $Ref from source via $mgr..."
  if ($mgr -eq 'bun') { & bun install -g $tmp } else { & npm install -g $tmp --no-audit --no-fund }
}

function Install-ViaBun {
  if ($Ref) { Install-FromRef 'bun'; return }
  Write-Host 'Installing @krtclcdy/tersio via bun...'
  & bun install -g "$Package@latest"
}

function Install-ViaNpm {
  if ($Ref) { Install-FromRef 'npm'; return }
  # Source preference: the GitHub release tarball built by CI per tag, falling
  # back to the npm registry (same package, same integrity checks). Override the
  # source with TERSIO_TARBALL_URL when needed.
  $tarballUrl = if ($env:TERSIO_TARBALL_URL) { $env:TERSIO_TARBALL_URL } else { "https://github.com/$Repo/releases/latest/download/tersio-npm.tgz" }
  $tarball = Join-Path ([System.IO.Path]::GetTempPath()) 'tersio-npm.tgz'
  $ok = $false
  try {
    Invoke-WebRequest -Uri $tarballUrl -OutFile $tarball -UseBasicParsing
    $ok = (Test-Path $tarball) -and ((Get-Item $tarball).Length -gt 0)
  } catch { $ok = $false }
  if ($ok) {
    Write-Host 'Installing tersio from the GitHub release tarball...'
    & npm install -g $tarball --no-audit --no-fund
  } else {
    Write-Host 'Installing @krtclcdy/tersio via npm...'
    & npm install -g "$Package@latest" --no-audit --no-fund
  }
}

switch ($Mode) {
  'bun' {
    if (-not (Test-Command 'bun')) { throw 'tersio installer: bun not found - install it first (https://bun.sh)' }
    Install-ViaBun
  }
  'npm' {
    if (-not (Test-Command 'npm')) { throw 'tersio installer: npm not found - install Node.js 20.12+ first (https://nodejs.org)' }
    Install-ViaNpm
  }
  default {
    if (Test-Command 'bun') { Install-ViaBun }
    elseif (Test-Command 'npm') { Install-ViaNpm }
    else { throw 'tersio installer: neither bun nor npm found - install bun (https://bun.sh) or Node.js 20.12+ (https://nodejs.org)' }
  }
}

# The global bin dir may not be on this shell's PATH yet. `npm prefix -g` on
# Windows is the shim directory itself, which is what we want.
$lane = if ($Mode -eq 'bun') { 'bun' } elseif ($Mode -eq 'npm') { 'npm' } elseif (Test-Command 'bun') { 'bun' } else { 'npm' }
$tersio = $null
if ($lane -eq 'npm') {
  $prefix = (& npm prefix -g 2>$null | Select-Object -First 1)
  if ($prefix) {
    foreach ($candidate in @((Join-Path $prefix 'tersio.cmd'), (Join-Path $prefix 'tersio.exe'), $prefix)) {
      if (Test-Path $candidate -PathType Leaf) { $tersio = $candidate; break }
    }
  }
}
if (-not $tersio) { $tersio = (Get-Command tersio -ErrorAction SilentlyContinue).Source }
if (-not $tersio) { throw 'tersio installer: tersio is not on PATH after the install' }

Write-Host ''
Write-Host 'Running the main installer...'
# A broken payload crashes on boot, so smoke-check before `tersio install` runs.
$smoke = & $tersio --version 2>&1
if ($LASTEXITCODE -ne 0) {
  $reason = ($smoke | Out-String).Trim()
  if (-not (Test-Command 'node')) {
    throw "tersio installer: the installed CLI did not answer --version ($reason). Node.js is required: the bin starts with '#!/usr/bin/env node'. Install Node.js 20.12+ (https://nodejs.org), then run: tersio install"
  }
  throw "tersio installer: the installed CLI did not answer --version ($reason)"
}

# An interactive PowerShell session gets the scope and Combo preset menus; a
# piped install (irm | iex) passes --yes and takes the user-scope defaults.
if ([Environment]::UserInteractive) {
  & $tersio install @Forward
} else {
  & $tersio install @Forward --yes
}
exit $LASTEXITCODE
