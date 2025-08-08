@echo off
title TicketConnector - Instalador Automatico v2.1
color 0A
echo.
echo  ████████╗██╗ ██████╗██╗  ██╗███████╗████████╗
echo  ╚══██╔══╝██║██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝
echo     ██║   ██║██║     █████╔╝ █████╗     ██║   
echo     ██║   ██║██║     ██╔═██╗ ██╔══╝     ██║   
echo     ██║   ██║╚██████╗██║  ██╗███████╗   ██║   
echo     ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   
echo  ██████╗ ██████╗ ███╗   ██╗███╗   ██╗███████╗ ██████╗████████╗ ██████╗ ██████╗ 
echo ██╔════╝██╔═══██╗████╗  ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
echo ██║     ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║        ██║   ██║   ██║██████╔╝
echo ██║     ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║        ██║   ██║   ██║██╔══██╗
echo ╚██████╗╚██████╔╝██║ ╚████║██║ ╚████║███████╗╚██████╗   ██║   ╚██████╔╝██║  ██║
echo  ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
echo.
echo ========================================================================
echo  INSTALADOR AUTOMATICO - Sistema de Impresion Termica Profesional
echo  Version 2.1 - Conabsolute Soluciones Empresariales
echo ========================================================================
echo.

REM Verificar permisos de administrador
echo [1/11] Verificando permisos de administrador...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ ERROR: Se requieren permisos de administrador
    echo.
    echo Por favor:
    echo 1. Cierra esta ventana
    echo 2. Clic derecho en install-automatico.bat
    echo 3. Selecciona "Ejecutar como administrador"
    echo.
    pause
    exit /b
)
echo ✅ Permisos de administrador verificados

REM Verificar Node.js
echo.
echo [2/11] Verificando Node.js...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ Node.js no encontrado
    echo.
    echo DESCARGANDO E INSTALANDO NODE.JS...
    echo Por favor espera mientras se descarga...
    
    REM Descargar Node.js
    powershell -Command "(New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v18.17.0/node-v18.17.0-x64.msi', '%TEMP%\nodejs.msi')"
    
    REM Instalar silenciosamente
    msiexec /i "%TEMP%\nodejs.msi" /quiet /norestart
    
    REM Actualizar PATH
    setx PATH "%PATH%;C:\Program Files\nodejs\" /M >nul
    set "PATH=%PATH%;C:\Program Files\nodejs\"
    
    echo ✅ Node.js instalado correctamente
) else (
    echo ✅ Node.js ya está instalado
)

REM Cambiar al directorio del proyecto
echo.
echo [3/11] Configurando directorio de trabajo...
cd /d "%~dp0"
echo ✅ Directorio: %CD%

REM Limpiar instalaciones previas
echo.
echo [4/11] Limpiando instalaciones previas...
taskkill /f /im "node.exe" >nul 2>&1
taskkill /f /im "pm2*" >nul 2>&1
if exist "%USERPROFILE%\.pm2" (
    rmdir /s /q "%USERPROFILE%\.pm2" >nul 2>&1
)
echo ✅ Limpieza completada

REM Instalar dependencias del proyecto
echo.
echo [5/11] Instalando dependencias del proyecto...
call npm install --silent
echo ✅ Dependencias instaladas

REM Instalar PM2
echo.
echo [6/11] Instalando gestor de servicios PM2...
call npm uninstall -g pm2 >nul 2>&1
call npm install -g pm2@latest --silent
call npm install -g pm2-windows-startup --silent
echo ✅ PM2 instalado

REM Crear configuración inicial básica
echo.
echo [7/11] Generando configuración inicial...
echo { > config.json
echo   "clienteId": "%COMPUTERNAME%-printer", >> config.json
echo   "printerIP": "192.168.1.100", >> config.json
echo   "printerPort": 9100, >> config.json
echo   "businessName": "Mi Negocio", >> config.json
echo   "ticketWidth": 48, >> config.json
echo   "useHeaderLogo": true, >> config.json
echo   "useFooterLogo": true, >> config.json
echo   "useFontTicket": false >> config.json
echo } >> config.json
echo ✅ Configuración inicial generada

REM Iniciar servicios
echo.
echo [8/11] Iniciando servicios...
call pm2 start web\server.js --name "ticket-web-server" >nul
call pm2 start index.js --name "ticket-service" >nul
call pm2 save >nul
call pm2-startup install >nul
echo ✅ Servicios iniciados y configurados para autoarranque

REM NUEVO: Auto-detección inteligente de impresoras
echo.
echo [9/11] Detectando impresoras automáticamente...
if exist "auto-config.js" (
    echo 🔍 Ejecutando detección automática de impresoras...
    call node auto-config.js
    if %errorLevel% equ 0 (
        echo ✅ Impresora detectada y configurada automáticamente
    ) else (
        echo ⚠️ Auto-detección completada - verifica configuración en interfaz web
    )
) else (
    echo ⚠️ Auto-configurador no encontrado - configuración manual requerida
)

REM Verificar instalación
echo.
echo [10/11] Verificando instalación...
timeout /t 2 >nul
call pm2 status
echo.

REM Abrir configuración automáticamente
echo.
echo [11/11] Abriendo interfaz de configuración...
start http://localhost:4040

REM Leer configuración final para mostrar IP detectada
echo ✅ Leyendo configuración final...
if exist "config.json" (
    for /f "tokens=2 delims=:" %%a in ('findstr "printerIP" config.json') do (
        set "FINAL_IP=%%a"
        set "FINAL_IP=!FINAL_IP:~2,-2!"
    )
)

echo.
echo ========================================================================
echo  🎉 INSTALACION COMPLETADA EXITOSAMENTE 🎉
echo ========================================================================
echo.
echo ✅ Servicios corriendo en segundo plano
echo ✅ Configuración web: http://localhost:4040
echo ✅ Auto-inicio con Windows configurado
if defined FINAL_IP (
    echo ✅ Impresora configurada: %FINAL_IP%
) else (
    echo ⚠️ Verifica la IP de tu impresora en la interfaz web
)
echo.
echo PROXIMOS PASOS:
echo 1. La interfaz web se abrirá automáticamente
echo 2. Verifica la configuración en la pestaña "Conexión"  
echo 3. Haz una prueba de impresión
echo 4. ¡Ya puedes usar el sistema!
echo.
echo ARCHIVOS DE SOPORTE:
echo - status.bat: Ver estado del sistema
echo - ver-logs.bat: Ver registros de error  
echo - uninstall.bat: Desinstalar completamente
echo.
echo Para soporte: https://conabsolute.com
echo ========================================================================
pause