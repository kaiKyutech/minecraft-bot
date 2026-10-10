param([ValidateSet('1.20.1','1.21.4')][string]$Version, [ValidateSet('prepare','start','status')][string]$Mode='status')
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$serverDir=Join-Path $repoRoot ('.cache/minecraft-bot/17-study/server-'+$Version)
if ($Mode -eq 'prepare') {
  if (Test-Path -LiteralPath $serverDir) { throw 'Dedicated destination already exists; preserve it and choose a new study directory.' }
  New-Item -ItemType Directory -Path $serverDir | Out-Null
  if ($Version -eq '1.21.4') {
    $sourceDir=[IO.Path]::GetFullPath((Join-Path $repoRoot '../isg/server-isg-1214'))
    & robocopy $sourceDir $serverDir /E /XF session.lock /XD logs world-base /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Server copy failed' }
  } else {
    $sourceDir=[IO.Path]::GetFullPath((Join-Path $repoRoot '../isg/runs/world-snapshot-2026-10-10b'))
    & robocopy $sourceDir (Join-Path $serverDir 'world') /E /XF session.lock /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'World copy failed' }
    foreach ($fileName in @('server-1.20.1.jar','server.properties','eula.txt')) {
      Copy-Item -LiteralPath (Join-Path $repoRoot ('../minecraft-server-vanilla/'+$fileName)) -Destination $serverDir
    }
  }
  $propertiesPath=Join-Path $serverDir 'server.properties'
  $contents=[IO.File]::ReadAllText($propertiesPath)
  $settings=@{'server-port'='25569';'query.port'='25569';'rcon.port'='25579';'online-mode'='false';'enable-rcon'='true';'level-name'='world'}
  foreach ($key in $settings.Keys) {
    $pattern='(?m)^'+[regex]::Escape($key)+'=.*$'
    if ([regex]::IsMatch($contents,$pattern)) {$contents=[regex]::Replace($contents,$pattern,$key+'='+$settings[$key])}
    else {$contents+="`n"+$key+'='+$settings[$key]}
  }
  [IO.File]::WriteAllText($propertiesPath,$contents)
  Write-Output "Prepared dedicated $Version copy (ports 25569/25579)."
}
if ($Mode -eq 'start') {
  if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 25569,25579) { throw 'Dedicated ports already occupied' }
  $properties=[IO.File]::ReadAllText((Join-Path $serverDir 'server.properties'))
  if ($properties -notmatch '(?m)^server-port=25569\r?$' -or $properties -notmatch '(?m)^rcon.port=25579\r?$') { throw 'Dedicated port verification failed' }
  $jarName=if($Version -eq '1.20.1'){'server-1.20.1.jar'}else{'fabric-server-launch.jar'}
  $process=Start-Process -FilePath 'C:/Program Files/Eclipse Adoptium/jdk-21.0.8.9-hotspot/bin/java.exe' -ArgumentList '-Xmx3G','-Xms1G','-jar',$jarName,'nogui' -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $serverDir 'study-stdout.log') -RedirectStandardError (Join-Path $serverDir 'study-stderr.log') -PassThru
  [IO.File]::WriteAllText((Join-Path $serverDir 'study.pid'),[string]$process.Id)
  Write-Output "Started dedicated $Version server PID $($process.Id)."
}
if ($Mode -eq 'status') {
  $logPath=Join-Path $serverDir 'study-stdout.log'
  $ready=$false
  if (Test-Path -LiteralPath $logPath) {
    $stream=[IO.File]::Open($logPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    $reader=[IO.StreamReader]::new($stream)
    try {$ready=$reader.ReadToEnd().Contains('Done (')} finally {$reader.Dispose()}
  }
  Write-Output ([pscustomobject]@{Version=$Version;Ready=$ready;ListeningPorts=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 25569,25579 | Select-Object -ExpandProperty LocalPort)})
}

