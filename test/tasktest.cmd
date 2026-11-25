@echo off
rem Aufgabentest starten: alle Struktogramme in test\samples in alle Sprachen übersetzen, echt ausführen,
rem mit dem Interpreter vergleichen und das Ergebnis in test\out\tasktest.xlsx speichern.
rem
rem   test\tasktest.cmd                 alle Aufgaben, alle Sprachen
rem   test\tasktest.cmd java python     nur diese Sprachen
rem   test\tasktest.cmd 06a 07          nur Aufgaben, deren Dateiname das enthält
rem
rem Per Doppelklick gestartet, bleibt das Fenster am Ende offen.
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

where node >nul 2>nul || (echo Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org & set RC=2 & goto :ende)
where python >nul 2>nul || echo Hinweis: Python wurde nicht gefunden - Python-Programme und das Excel-Protokoll fehlen dann.

node test\tasktest.js %*
set RC=%ERRORLEVEL%

:ende
rem per Doppelklick (Explorer startet "cmd /c ..."): Fenster offen lassen - nicht im Terminal von VS Code
if not "%TERM_PROGRAM%"=="vscode" echo %CMDCMDLINE% | "%SystemRoot%\System32\find.exe" /i "/c" >nul && (echo. & pause)
exit /b %RC%
