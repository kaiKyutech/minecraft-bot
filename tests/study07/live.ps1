param([ValidateSet('O1','O2','baseline')][string]$Phase='O1',[int]$Interval=3000,[string]$Goal='inventory.category.log:4')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$server=[IO.Path]::GetFullPath((Join-Path $repo '.cache/minecraft-bot/07-study/server'))
$base=(Resolve-Path -LiteralPath (Join-Path $repo '../isg/server-natural/world-05-base')).Path
$jar=(Resolve-Path -LiteralPath (Join-Path $repo '../minecraft-server-vanilla/server-1.20.1.jar')).Path
if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in 25569,25579}).Count){throw 'Dedicated ports busy'}
if($server -ne "$repo\.cache\minecraft-bot\07-study\server"){throw 'Unexpected server target'}
New-Item -ItemType Directory -Path $server -Force|Out-Null
$world=Join-Path $server 'world'
if(Test-Path -LiteralPath $world){Remove-Item -LiteralPath $world -Recurse -Force}
Copy-Item -LiteralPath $base -Destination $world -Recurse
$props=Get-Content -LiteralPath (Join-Path $repo '../isg/server-natural/server.properties') -Raw
$props=$props -replace '(?m)^server-port=.*','server-port=25569' -replace '(?m)^rcon.port=.*','rcon.port=25579' -replace '(?m)^level-name=.*','level-name=world'
[IO.File]::WriteAllText((Join-Path $server 'server.properties'),$props)
[IO.File]::WriteAllText((Join-Path $server 'eula.txt'),'eula=true')
$process=Start-Process -FilePath java -ArgumentList '-Xmx4G','-Xms4G','-jar',$jar,'nogui' -WorkingDirectory $server -WindowStyle Hidden -PassThru
try{
  $ready=$false
  for($i=0;$i -lt 60;$i++) {Start-Sleep -Seconds 1;if($process.HasExited){throw 'Server exited'};if((Test-Path "$server\logs\latest.log") -and (Select-String -LiteralPath "$server\logs\latest.log" -Pattern 'Done \(' -Quiet)){$ready=$true;break}}
  if(-not $ready){throw 'Startup timeout'}
  & node (Join-Path $PSScriptRoot 'concurrent.cjs') $Phase $Interval $Goal
  if($LASTEXITCODE -ne 0){throw 'Trial failed'}
}finally{
  if(-not $process.HasExited){& node (Join-Path $PSScriptRoot 'concurrent.cjs') stop;if(-not $process.WaitForExit(30000)){throw 'Shutdown timeout'}}
}
