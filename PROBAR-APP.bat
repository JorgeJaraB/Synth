@echo off
title Synth Manos - probar
cd /d "%~dp0"
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Falta Node.js en este ordenador.
  echo  Se abrira la web: descarga la version LTS, instalala con las opciones
  echo  por defecto y despues vuelve a hacer doble clic en este archivo.
  echo.
  pause
  start "" "https://nodejs.org/es/download"
  exit /b 1
)
if not exist "node_modules" (
  echo  Primera vez: descargando lo necesario. Puede tardar unos minutos...
  echo.
  call npm ci
  if errorlevel 1 goto error
)
echo.
echo  Abriendo Synth Manos...
call npm start
if errorlevel 1 goto error
exit /b 0
:error
echo.
echo  Algo ha fallado. Haz una captura de esta ventana y enviasela a Claude.
pause
exit /b 1
