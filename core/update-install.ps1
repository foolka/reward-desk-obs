param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$backup = $null
try {
  $r = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($r.version -notmatch '^\d+\.\d+\.\d+$' -or $r.hash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update request' }
  $exe = [IO.Path]::GetFullPath($r.executable)
  $profile = [IO.Path]::GetFullPath($r.profile)
  $folder = [IO.Path]::GetFullPath($r.folder)
  if ([IO.Path]::GetFileName($exe) -ne 'RewardDesk.exe') { throw 'Not a packaged Reward Desk installation' }
  if ((Get-FileHash -LiteralPath $r.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $r.hash) { throw 'Installer checksum mismatch' }
  Set-Content -LiteralPath $r.ready -Value 'ready' -Encoding ASCII
  $commit = Join-Path $folder 'commit'
  $deadline = (Get-Date).AddSeconds(90)
  while (!(Test-Path -LiteralPath $commit)) {
    if ((Get-Date) -gt $deadline) { exit 0 }
    Start-Sleep -Milliseconds 200
  }
  while (Get-Process -Id $r.pid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { throw 'Application did not close; update cancelled' }
    Start-Sleep -Milliseconds 250
  }
  while (Get-Process -Name RewardDesk -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { throw 'Another Reward Desk process is running; update cancelled' }
    Start-Sleep -Milliseconds 250
  }
  $backup = Join-Path $r.backupRoot ($r.version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
  if ([IO.Path]::GetFullPath($backup).StartsWith($profile + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must be outside profile' }
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Copy-Item -LiteralPath $profile -Destination (Join-Path $backup 'RewardDesk') -Recurse
  $before = @{}
  Get-ChildItem -LiteralPath $profile -File -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($profile.Length + 1)
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath (Join-Path (Join-Path $backup 'RewardDesk') $relative) -Algorithm SHA256).Hash -ne $hash) { throw 'Backup verification failed' }
    $before[$relative] = $hash
  }
  if (!(Test-Path -LiteralPath (Join-Path $backup 'RewardDesk/rewards.sqlite'))) { throw 'Database backup missing' }
  $before | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'checksums.json') -Encoding UTF8
  $args = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',('/DIR="' + [IO.Path]::GetDirectoryName($exe) + '"'),('/LOG="' + (Join-Path $folder 'installer.log') + '"'))
  $setup = Start-Process -FilePath $r.file -ArgumentList $args -WindowStyle Hidden -PassThru -Wait
  if ($setup.ExitCode -ne 0) { throw ('Installer exit code ' + $setup.ExitCode) }
  if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne $r.version) { throw 'Installed version mismatch' }
  foreach ($relative in $before.Keys) {
    if ((Get-FileHash -LiteralPath (Join-Path $profile $relative) -Algorithm SHA256).Hash -ne $before[$relative]) { throw ('Profile changed: ' + $relative) }
  }
  @{ success = $true; version = $r.version; backup = $backup } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'result.json') -Encoding UTF8
  Start-Process -FilePath $exe -WorkingDirectory ([IO.Path]::GetDirectoryName($exe)) -WindowStyle Hidden
} catch {
  $message = $_.Exception.Message
  if ($r.folder) { @{ success = $false; error = $message; backup = $backup } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $r.folder 'result.json') -Encoding UTF8 }
  if ($commit -and (Test-Path -LiteralPath $commit)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("Reward Desk update stopped.`n$message`nBackup: $backup", 'Reward Desk') | Out-Null
  }
  exit 1
}
