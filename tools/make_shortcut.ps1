# Creates MiniPet.lnk (cat icon, no console window) next to index.html.
# Run again if the folder moves:  powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1
$root = Split-Path -Parent $PSScriptRoot
$exe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
         "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") |
       Where-Object { Test-Path $_ } | Select-Object -First 1
$url = 'file:///' + ($root -replace '\\', '/') + '/index.html?app'
$prof = Join-Path $env:LOCALAPPDATA 'MiniPet\browser'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $root 'MiniPet.lnk'))
$s.TargetPath = $exe
$s.Arguments = "--app=`"$url`" --user-data-dir=`"$prof`" --window-size=560,380 --no-first-run --no-default-browser-check --disable-sync --disable-extensions --disable-default-apps --disable-component-update"
$s.IconLocation = (Join-Path $root 'data\icon.ico') + ',0'
$s.WorkingDirectory = $root
$s.Description = 'Mini Pet'
$s.Save()
"created: $(Join-Path $root 'MiniPet.lnk') -> $exe"
