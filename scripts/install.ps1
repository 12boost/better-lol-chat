$ErrorActionPreference = 'Stop'
$ZipUrl = '__ZIP_URL__'

function Wait-Close([int]$Code) {
  Write-Host ''
  Read-Host 'Press Enter to close'
  exit $Code
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PenguRoot {
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe'
  )
  foreach ($key in $keys) {
    try {
      $debugger = (Get-ItemProperty -LiteralPath $key -Name Debugger -ErrorAction Stop).Debugger
    } catch {
      continue
    }
    if ($debugger -match '"([^"]+)"') {
      $dll = $Matches[1]
      if (Test-Path -LiteralPath $dll) {
        return (Split-Path -Parent $dll)
      }
    }
  }
  $fallback = Join-Path $env:ProgramFiles 'Pengu Loader'
  $core = Join-Path $fallback 'core.dll'
  if (Test-Path -LiteralPath $core) { return $fallback }
  return $null
}

function Resolve-PluginsDir([string]$Picked) {
  if (-not $Picked) { return $null }
  $core = Join-Path $Picked 'core.dll'
  $exe = Join-Path $Picked 'Pengu Loader.exe'
  if ((Test-Path -LiteralPath $core) -or (Test-Path -LiteralPath $exe)) {
    $plugins = Join-Path $Picked 'plugins'
    if (-not (Test-Path -LiteralPath $plugins)) {
      New-Item -ItemType Directory -Path $plugins | Out-Null
    }
    return $plugins
  }
  if ((Split-Path -Leaf $Picked) -eq 'plugins') {
    $parent = Split-Path -Parent $Picked
    $parentCore = Join-Path $parent 'core.dll'
    $parentExe = Join-Path $parent 'Pengu Loader.exe'
    if ((Test-Path -LiteralPath $parentCore) -or (Test-Path -LiteralPath $parentExe)) {
      return $Picked
    }
  }
  return $null
}

function Find-PluginsDir {
  $root = Get-PenguRoot
  if ($root) {
    $plugins = Resolve-PluginsDir $root
    if ($plugins) { return $plugins }
  }
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select the Pengu Loader folder. It contains Pengu Loader.exe.'
  $dialog.ShowNewFolderButton = $false
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true
  $owner.ShowInTaskbar = $false
  $result = $dialog.ShowDialog($owner)
  $owner.Dispose()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return Resolve-PluginsDir $dialog.SelectedPath
}

function Test-DirWritable([string]$Dir) {
  $probe = Join-Path $Dir ('.blc-write-' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($probe, '')
    return $true
  } catch {
    return $false
  } finally {
    if (Test-Path -LiteralPath $probe) {
      Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    }
  }
}

if ($env:BLC_SELF_TEST -eq '1') {
  $selfRoot = Get-PenguRoot
  if (-not $selfRoot) { Write-Output 'root='; exit 1 }
  Write-Output "root=$selfRoot"
  exit 0
}

if ($ZipUrl -notmatch '^https://github\.com/12boost/better-lol-chat/releases/download/[^/]+/better-lol-chat\.zip$') {
  Write-Host 'This installer is missing its download address.'
  Wait-Close 1
}

if (-not $env:BLC_BAT) {
  Write-Host 'Run this file to install better-lol-chat.'
  Wait-Close 1
}

$plugins = Find-PluginsDir
if (-not $plugins -or (Split-Path -Leaf $plugins) -ne 'plugins') {
  Write-Host 'Pengu Loader was not found. Turn Pengu on once, or choose the folder that contains Pengu Loader.exe.'
  Wait-Close 1
}

$dest = Join-Path $plugins 'better-lol-chat'
if ((Split-Path -Leaf $dest) -ne 'better-lol-chat') {
  Write-Host 'Refusing to copy outside the Pengu plugins folder.'
  Wait-Close 1
}

if (-not (Test-DirWritable $plugins)) {
  if (Test-Admin) {
    Write-Host 'Cannot write to:'
    Write-Host $plugins
    Wait-Close 1
  }
  Write-Host 'Windows will ask for permission to copy into the Pengu folder.'
  try {
    Start-Process -FilePath $env:BLC_BAT -Verb RunAs
  } catch {
    Write-Host 'Permission was not granted, so the plugin was not copied.'
    Wait-Close 1
  }
  exit 0
}

$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tempRoot = Join-Path $env:TEMP ('blc-install-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $zip = Join-Path $tempRoot 'plugin.zip'
  Write-Host 'Downloading better-lol-chat...'
  Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
  $expanded = Join-Path $tempRoot 'src'
  Expand-Archive -LiteralPath $zip -DestinationPath $expanded -Force
  $source = Join-Path $expanded 'better-lol-chat'
  $entry = Join-Path $source 'index.js'
  if (-not (Test-Path -LiteralPath $entry)) {
    Write-Host 'The download did not contain the plugin.'
    Wait-Close 1
  }
  Write-Host "Copying to $dest"
  robocopy $source $dest /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
  $copyCode = $LASTEXITCODE
  if ($copyCode -ge 8) {
    Write-Host "Copy failed. Close League and run this file again."
    Wait-Close 1
  }
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$version = ''
$installedIndex = Join-Path $dest 'index.js'
if (Test-Path -LiteralPath $installedIndex) {
  $versionLine = Select-String -LiteralPath $installedIndex -Pattern "^const VERSION = '([^']+)'" | Select-Object -First 1
  if ($versionLine) { $version = $versionLine.Matches[0].Groups[1].Value }
}

Write-Host ''
if ($version) {
  Write-Host "Installed better-lol-chat v$version."
} else {
  Write-Host 'Installed better-lol-chat.'
}
Write-Host $dest
Write-Host 'Restart League to load it. (Ctrl + R in client)'
Wait-Close 0
