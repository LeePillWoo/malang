@echo off
rem Mini Pet launcher: opens index.html as a small app window (Chrome, or Edge if Chrome is missing).
rem The page remembers its own window size and position (index.html?app).
setlocal
set "HERE=%~dp0"
set "URL=file:///%HERE:\=/%index.html?app"
set "PROFILE=%LOCALAPPDATA%\MiniPet\browser"
set "EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%EXE%" set "EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
start "" "%EXE%" --app="%URL%" --user-data-dir="%PROFILE%" --window-size=560,380 --no-first-run --no-default-browser-check --disable-sync --disable-extensions --disable-default-apps --disable-component-update
