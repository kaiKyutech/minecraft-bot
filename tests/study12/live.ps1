$ErrorActionPreference = 'Stop'
$gatherRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$gatherServer = Join-Path $gatherRoot '.cache/minecraft-bot/12-study/server'
$gatherWorld = [IO.Path]::GetFullPath((Join-Path $gatherServer 'world'))
if (-not $gatherWorld.StartsWith(($gatherRoot + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test world outside workspace' }
if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 25569,25579 }) { throw 'Dedicated test ports are already occupied' }
New-Item -ItemType Directory -Force $gatherServer | Out-Null
if (Test-Path -LiteralPath $gatherWorld) { Move-Item -LiteralPath $gatherWorld -Destination (Join-Path $gatherServer ('world-previous-' + [guid]::NewGuid().ToString('N'))) }
Copy-Item -LiteralPath (Join-Path $gatherRoot '../isg/runs/world-snapshot-2026-10-10b') -Destination $gatherWorld -Recurse
$gatherPassword = [guid]::NewGuid().ToString('N')
[IO.File]::WriteAllLines((Join-Path $gatherServer 'server.properties'), @('server-port=25569','server-ip=127.0.0.1','enable-rcon=true','rcon.port=25579',('rcon.password=' + $gatherPassword),'online-mode=false','level-name=world','difficulty=peaceful','gamemode=survival','spawn-protection=0','view-distance=8','simulation-distance=6','max-players=4'))
[IO.File]::WriteAllText((Join-Path $gatherServer 'eula.txt'), 'eula=true')
$gatherJava = Start-Process -FilePath java -ArgumentList '-Xmx2G','-Xms1G','-jar',(Join-Path $gatherRoot '../minecraft-server-vanilla/server-1.20.1.jar'),'nogui' -WorkingDirectory $gatherServer -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gatherServer 'stdout.log') -RedirectStandardError (Join-Path $gatherServer 'stderr.log') -PassThru
$gatherJava.Id | Set-Content (Join-Path $gatherServer 'pid.txt')
Write-Output ('Dedicated copied-world server PID ' + $gatherJava.Id)
