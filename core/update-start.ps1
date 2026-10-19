param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$folder = [IO.Path]::GetDirectoryName($RequestPath)
$helper = Join-Path $folder 'install.ps1'
$arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $helper + '"'), '-RequestPath', ('"' + $RequestPath + '"'))
Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput (Join-Path $folder 'helper-output.log') -RedirectStandardError (Join-Path $folder 'helper-error.log') | Out-Null
