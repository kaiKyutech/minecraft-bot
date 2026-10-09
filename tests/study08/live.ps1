$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$study = [IO.Path]::GetFullPath((Join-Path $repo '.cache/minecraft-bot/08-study'))
$server = Join-Path $study 'server'
$source = (Resolve-Path -LiteralPath (Join-Path $repo '../isg/server-natural')).Path
$snapshot = Join-Path $source 'world-05-base'
$jar = (Resolve-Path -LiteralPath (Join-Path $repo '../minecraft-server-vanilla/server-1.20.1.jar')).Path
if (-not $server.StartsWith($repo + '\.cache\minecraft-bot\08-study\')) { throw 'Unexpected isolated server path' }
function Listening { @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 25569,25579 }).Count -gt 0 }
Get-NetTCPConnection -LocalPort 25567 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess
if (Listening) { throw '08 ports already occupied; do not interrupt another server' }
if (-not (Test-Path -LiteralPath $server)) {
  New-Item -ItemType Directory -Path $server -Force | Out-Null
  # Immutable, stopped baseline: never copies the current world while 07 uses it.
  Copy-Item -LiteralPath $snapshot -Destination (Join-Path $server 'world') -Recurse
  Copy-Item -LiteralPath (Join-Path $source 'eula.txt') -Destination $server
  $settings = [IO.File]::ReadAllText((Join-Path $source 'server.properties'))
  foreach ($entry in @{ 'server-port'='25569'; 'rcon.port'='25579'; 'server-ip'='127.0.0.1'; 'enable-rcon'='true'; 'level-name'='world'; 'view-distance'='6'; 'simulation-distance'='6' }.GetEnumerator()) {
    $pattern = '(?m)^' + [regex]::Escape($entry.Key) + '=.*$'
    if ([regex]::IsMatch($settings,$pattern)) { $settings = [regex]::Replace($settings,$pattern,$entry.Key+'='+$entry.Value) }
    else { $settings += "`r`n" + $entry.Key+'='+$entry.Value }
  }
  [IO.File]::WriteAllText((Join-Path $server 'server.properties'),$settings,[Text.UTF8Encoding]::new($false))
}
$process = Start-Process -FilePath java -ArgumentList '-Xmx4G','-Xms4G','-jar',$jar,'nogui' -WorkingDirectory $server -WindowStyle Hidden -PassThru
try {
  $ready = $false
  for ($n=0; $n -lt 60; $n++) {
    Start-Sleep -Seconds 1
    if ($process.HasExited) { throw '08 server exited during startup' }
    if ((Listening) -and (Test-Path -LiteralPath "$server\logs\latest.log") -and (Select-String -LiteralPath "$server\logs\latest.log" -Pattern 'Done \(' -Quiet)) { $ready=$true;break }
  }
  if (-not $ready) { throw '08 startup timeout' }
  & node (Join-Path $PSScriptRoot 'live.cjs')
  if ($LASTEXITCODE -ne 0) { throw '08 live test failed' }
} finally {
  if (-not $process.HasExited) {
    & node (Join-Path $PSScriptRoot 'live.cjs') stop
    if ($LASTEXITCODE -ne 0) { throw '08 normal RCON shutdown failed' }
    if (-not $process.WaitForExit(30000)) { throw '08 shutdown timeout; leave saved world intact' }
  }
}
if (Listening) { throw '08 ports still occupied after shutdown' }
if (-not (Select-String -LiteralPath "$server\logs\latest.log" -Pattern 'All dimensions are saved' -Quiet)) { throw '08 dimension save not confirmed' }
Write-Output '08 live passed; normal save/stop, Java exit and port release confirmed'
