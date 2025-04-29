@echo off
echo Instalando servicio de impresion de tickets...

REM Ejecutamos como administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Este script requiere permisos de administrador.
    echo Por favor, cierra esta ventana y ejecuta como administrador.
    pause
    exit /b
)

REM Cambiamos al directorio del script (donde está el proyecto)
cd /d "%~dp0"
echo Directorio actual: %CD%

REM Detenemos cualquier instancia previa de PM2 que pueda estar causando problemas
echo Deteniendo instancias previas de PM2...
taskkill /f /im "pm2*" >nul 2>&1
taskkill /f /im "node*" >nul 2>&1

REM Limpiamos archivos temporales de PM2
echo Limpiando archivos temporales...
if exist "%USERPROFILE%\.pm2" (
    rmdir /s /q "%USERPROFILE%\.pm2"
)

REM Desinstalamos PM2 e instalamos nuevamente
echo Reinstalando PM2...
call npm uninstall -g pm2
call npm install -g pm2@latest

REM Verificamos que los archivos existen antes de continuar
echo Verificando archivos del proyecto...
if not exist "web\server.js" (
    echo ERROR: No se encontró el archivo web\server.js
    echo Directorio actual: %CD%
    echo Contenido del directorio:
    dir
    echo.
    echo Por favor, asegúrate de ejecutar este script desde el directorio raíz del proyecto.
    pause
    exit /b
)

if not exist "index.js" (
    echo ERROR: No se encontró el archivo index.js
    echo Directorio actual: %CD%
    echo Contenido del directorio:
    dir
    echo.
    echo Por favor, asegúrate de ejecutar este script desde el directorio raíz del proyecto.
    pause
    exit /b
)

REM Instalamos las dependencias del proyecto
echo Instalando dependencias del proyecto...
call npm install

REM Obtenemos la ruta completa al directorio actual
set "PROJECT_PATH=%CD%"
echo Ruta del proyecto: %PROJECT_PATH%

REM Iniciamos PM2 como daemon
echo Iniciando PM2 daemon...
call pm2 ping

REM Configuramos PM2 para iniciar los servicios con rutas absolutas
echo Configurando servicios...
call pm2 start "%PROJECT_PATH%\web\server.js" --name "ticket-web-server"
call pm2 start "%PROJECT_PATH%\index.js" --name "ticket-service"

REM Guardamos la configuración actual
echo Guardando configuracion...
call pm2 save

REM Usamos pm2-windows-startup en lugar del comando startup estándar
echo Instalando inicio automático para Windows...
call npm install -g pm2-windows-startup
call pm2-startup install

echo.
echo Instalacion completada! El servicio de impresion de tickets ahora se iniciara automaticamente con Windows.
echo Para verificar el estado, puedes ejecutar "pm2 status" en cualquier momento.
echo.
pause