param([ValidateSet('before','D1','D2','P1','after')][string]$Phase, [int[]]$Cases = (0..8))
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$server = (Resolve-Path -LiteralPath (Join-Path $repo '../isg/server-natural')).Path
$world = [IO.Path]::GetFullPath((Join-Path $server 'world'))
$base = (Resolve-Path -LiteralPath (Join-Path $server 'world-05-base')).Path
$jar = (Resolve-Path -LiteralPath (Join-Path $repo '../minecraft-server-vanilla/server-1.20.1.jar')).Path
function Listening { @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 25567,25577 }).Count -gt 0 }
if ($server -ne 'C:\Users\kaiha\personal-files\akai_project\isg\server-natural' -or $world -ne "$server\world" -or $base -ne "$server\world-05-base") { throw 'Unexpected restore path' }
foreach ($index in $Cases) {
  if (Listening) { throw 'Server must be stopped before world restore' }
  Remove-Item -LiteralPath $world -Recurse -Force
  Copy-Item -LiteralPath $base -Destination $world -Recurse
  $process = Start-Process -FilePath java -ArgumentList '-Xmx4G','-Xms4G','-jar',$jar,'nogui' -WorkingDirectory $server -WindowStyle Hidden -PassThru
  try {
    $ready = $false
    for ($n=0; $n -lt 60; $n++) {
      Start-Sleep -Seconds 1
      if ($process.HasExited) { throw 'Server exited during startup' }
      if ((Listening) -and (Select-String -LiteralPath "$server\logs\latest.log" -Pattern 'Done \(' -Quiet)) { $ready=$true;break }
    }
    if (-not $ready) { throw 'Server startup timeout' }
    & node (Join-Path $PSScriptRoot 'live.cjs') $Phase $index
    if ($LASTEXITCODE -ne 0) { throw 'Live trial script failed' }
  } finally {
    if (-not $process.HasExited) {
      & node (Join-Path $PSScriptRoot 'live.cjs') stop
      if (-not $process.WaitForExit(30000)) { throw 'Normal server shutdown timeout; do not restore world' }
    }
  }
  if (Listening) { throw 'Ports remain open after shutdown' }
}
