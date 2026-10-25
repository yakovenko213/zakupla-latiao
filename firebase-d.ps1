$ErrorActionPreference = 'Stop'
$env:XDG_CONFIG_HOME = 'D:\zakupka-latiao\.config'
$env:TEMP = 'D:\zakupka-latiao\.tmp'
$env:TMP = 'D:\zakupka-latiao\.tmp'
$env:npm_config_cache = 'D:\zakupka-latiao\.cache\npm'
$env:NODE_OPTIONS = '--use-system-ca'
New-Item -ItemType Directory -Force $env:XDG_CONFIG_HOME, $env:TEMP, $env:npm_config_cache | Out-Null
& "$PSScriptRoot\node_modules\.bin\firebase.cmd" @args
