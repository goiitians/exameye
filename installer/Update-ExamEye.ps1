# ExamEye updater for Windows. Runs at logon and hourly (Scheduled Task "ExamEye Update",
# registered by Install-ExamEye.cmd). Swaps the extension folder only while Chrome is closed,
# so a running exam never sees mixed files. Log: %USERPROFILE%\ExamEye-updater\update.log
param([string]$BaseUrl = 'https://github.com/goiitians/exameye/releases/latest/download')
$ErrorActionPreference = 'Stop'
$ext = Join-Path $env:USERPROFILE 'ExamEye'
$dir = Join-Path $env:USERPROFILE 'ExamEye-updater'
$log = Join-Path $dir 'update.log'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Log($msg) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $msg) }
function VersionOf($manifest) { (Get-Content -Raw $manifest | ConvertFrom-Json).version }
function Newer($a, $b) {
  $x = $a.Split('.'); $y = $b.Split('.')
  for ($i = 0; $i -lt [Math]::Max($x.Count, $y.Count); $i++) {
    $p = if ($i -lt $x.Count) { [int]$x[$i] } else { 0 }
    $q = if ($i -lt $y.Count) { [int]$y[$i] } else { 0 }
    if ($p -ne $q) { return $p -gt $q }
  }
  return $false
}

$tmp = $null
try {
  $manifest = Join-Path $ext 'manifest.json'
  if (-not (Test-Path $manifest)) { Log 'failed: not installed'; exit 0 }
  $installed = VersionOf $manifest
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $latest = (Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/version.txt").Content.Trim()
  if (-not (Newer $latest $installed)) { Log "up to date $installed"; exit 0 }
  if (Get-Process -Name chrome, msedge -ErrorAction SilentlyContinue) { Log "skipped ${latest}: chrome running"; exit 0 }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('exameye-update-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'exameye-installer.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/exameye-installer.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp
  $src = Join-Path $tmp 'exameye-installer'
  $got = VersionOf (Join-Path $src 'ExamEye\manifest.json')
  if ($got -ne $latest) { Log "failed: bad archive ($got)"; exit 0 }
  # defaults.json carries the seat id typed at install and is read once, on first install
  robocopy (Join-Path $src 'ExamEye') $ext /MIR /XF defaults.json /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Log 'failed: mirror'; exit 0 }
  Copy-Item (Join-Path $src 'Update-ExamEye.ps1') (Join-Path $dir 'Update-ExamEye.ps1') -Force
  Log "updated $installed -> $latest"
} catch {
  Log ('failed: ' + $_.Exception.Message)
} finally {
  if ($tmp -and (Test-Path $tmp)) { Remove-Item -Recurse -Force $tmp }
}
