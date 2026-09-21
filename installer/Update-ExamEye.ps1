# ExamEye updater for Windows. Runs at logon and hourly (Scheduled Task "ExamEye Update",
# registered by Install-ExamEye.cmd). Swaps the extension folder only while Chrome is closed,
# so a running exam never sees mixed files. Log: %USERPROFILE%\ExamEye-updater\update.log
param([string]$BaseUrl = 'https://github.com/goiitians/exameye/releases/latest/download')
$ErrorActionPreference = 'Stop'
$ext = Join-Path $env:USERPROFILE 'ExamEye'
$new = "$ext.new"
$old = "$ext.old"
$dir = Join-Path $env:USERPROFILE 'ExamEye-updater'
$log = Join-Path $dir 'update.log'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Log($msg) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture), $msg) }
function VersionOf($manifest) { (Get-Content -Raw $manifest | ConvertFrom-Json).version }
function ChromeRunning { [bool](Get-Process -Name chrome, msedge -ErrorAction SilentlyContinue) }
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
  # a run that died between the two renames of the swap left the live folder under the .old name
  if (-not (Test-Path $ext) -and (Test-Path $old)) { Rename-Item -Path $old -NewName (Split-Path -Leaf $ext) }
  $manifest = Join-Path $ext 'manifest.json'
  if (-not (Test-Path $manifest)) { Log 'failed: not installed'; exit 0 }
  $installed = VersionOf $manifest
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('exameye-update-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  # release assets come as application/octet-stream, for which PowerShell 5.1 leaves .Content empty
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/version.txt" -OutFile (Join-Path $tmp 'version.txt') -TimeoutSec 60
  $latest = "$(Get-Content -Raw (Join-Path $tmp 'version.txt'))".Trim()
  if (-not $latest) { Log 'failed: empty version.txt'; exit 0 }
  if (-not (Newer $latest $installed)) { Log "up to date $installed"; exit 0 }
  if (ChromeRunning) { Log "skipped ${latest}: chrome running"; exit 0 }
  $zip = Join-Path $tmp 'exameye-installer.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/exameye-installer.zip" -OutFile $zip -TimeoutSec 300
  Expand-Archive -Path $zip -DestinationPath $tmp
  $src = Join-Path $tmp 'exameye-installer'
  $got = VersionOf (Join-Path $src 'ExamEye\manifest.json')
  if ($got -ne $latest) { Log "failed: bad archive ($got)"; exit 0 }
  # stage next to the live folder and swap by two renames: a failure anywhere leaves the live folder untouched
  foreach ($d in @($new, $old)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
  & { $ErrorActionPreference = 'Continue'; robocopy (Join-Path $src 'ExamEye') $new /E /NFL /NDL /NJH /NJS /NP 2>$null } | Out-Null
  if ($LASTEXITCODE -ge 8) { Log 'failed: mirror'; exit 0 }
  # defaults.json carries the seat id typed at install and is read once, on first install
  if (Test-Path (Join-Path $ext 'defaults.json')) { Copy-Item (Join-Path $ext 'defaults.json') (Join-Path $new 'defaults.json') -Force }
  if (ChromeRunning) { Log "skipped ${latest}: chrome running"; exit 0 }
  Rename-Item -Path $ext -NewName (Split-Path -Leaf $old)
  try { Rename-Item -Path $new -NewName (Split-Path -Leaf $ext) } catch { Rename-Item -Path $old -NewName (Split-Path -Leaf $ext); throw }
  $note = ''
  try { Remove-Item -Recurse -Force $old } catch { $note += ' (cleanup failed)' }
  try { Copy-Item (Join-Path $src 'Update-ExamEye.ps1') (Join-Path $dir 'Update-ExamEye.ps1') -Force } catch { $note += ' (self-copy failed)' }
  Log "updated $installed -> $latest$note"
} catch {
  Log (('failed: ' + $_.Exception.Message) -replace '\s+', ' ')
} finally {
  if ($tmp -and (Test-Path $tmp)) { Remove-Item -Recurse -Force $tmp }
  if (Test-Path $new) { Remove-Item -Recurse -Force $new }
}
