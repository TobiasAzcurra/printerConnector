@echo off
title TicketConnector - Desinstalador Mejorado v2.0
color 0C
echo.
echo ████████╗██╗ ██████╗██╗  ██╗███████╗████████╗
echo ╚══██╔══╝██║██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝
echo    ██║   ██║██║     █████╔╝ █████╗     ██║   
echo    ██║   ██║██║     ██╔═██╗ ██╔══╝     ██║   
echo    ██║   ██║╚██████╗██║  ██╗███████╗   ██║   
echo    ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   
echo.
echo ========================================================================
echo  DESINSTALADOR COMPLETO - Sistema de Impresion Termica
echo  Version 2.0 - Conabsolute Soluciones Empresariales  
echo ========================================================================
echo.

REM Verificar permisos de administrador
echo [1/6] Verificando permisos de administrador...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ❌ ERROR: Se requieren permisos de administrador
    echo.
    echo Por favor:
    echo 1. Cierra esta ventana
    echo 2. Clic derecho en uninstall-mejorado.bat
    echo 3. Selecciona "Ejecutar como administrador"
    echo.
    pause
    exit /b
)
echo ✅ Permisos verificados

echo.
echo ⚠️  ATENCION: Se va a desinstalar completamente TicketConnector
echo.
echo Esto incluye:
echo - Detener todos los servicios en ejecución
echo - Eliminar configuración de auto-inicio
echo - Limpiar archivos temporales
echo - Remover PM2 del sistema
echo.
set /p CONFIRM="¿Estás seguro de continuar? (S/N): "
if /i not "%CONFIRM%"=="S" (
    echo.
    echo ❌ Desinstalación cancelada por el usuario
    pause
    exit /b
)

echo.
echo [2/6] Deteniendo servicios TicketConnector...
call pm2 stop ticket-web-server >nul 2>&1
call pm2 stop ticket-service >nul 2>&1
echo ✅ Servicios detenidos

echo.
echo [3/6] Eliminando servicios de PM2...
call pm2 delete ticket-web-server >nul 2>&1
call pm2 delete ticket-service >nul 2>&1
echo ✅ Servicios eliminados

echo.
echo [4/6] Removiendo auto-inicio de Windows...
call pm2 save >nul 2>&1
call pm2 unstartup >nul 2>&1
call pm2-startup uninstall >nul 2>&1
echo ✅ Auto-inicio removido

echo.
echo [5/6] Limpiando archivos del sistema...

REM Limpiar PM2
if exist "%USERPROFILE%\.pm2" (
    rmdir /s /q "%USERPROFILE%\.pm2" >nul 2>&1
    echo ✅ Archivos PM2 eliminados
)

REM Limpiar archivos temporales del proyecto
if exist "temp-*.png" del "temp-*.png" >nul 2>&1
if exist "temp-*.json" del "temp-*.json" >nul 2>&1
if exist "system-report.json" del "system-report.json" >nul 2>&1

REM Backup de configuración antes de eliminar (opcional)
if exist "config.json" (
    copy "config.json" "config-backup-%DATE:~-4,4%%DATE:~3,2%%DATE:~0,2%.json" >nul 2>&1
    echo ✅ Configuración respaldada
)

echo.
echo [6/6] Verificación final...
call pm2 status >nul 2>&1
if %errorLevel% equ 0 (
    echo ⚠️  PM2 todavía responde - algunos procesos pueden seguir activos
    echo    Esto es normal si tienes otros proyectos Node.js
) else (
    echo ✅ Sistema completamente limpio
)

REM Preguntar si eliminar PM2 completamente
echo.
set /p REMOVE_PM2="¿Eliminar PM2 completamente del sistema? (S/N): "
if /i "%REMOVE_PM2%"=="S" (
    echo Desinstalando PM2...
    call npm uninstall -g pm2 >nul 2>&1
    call npm uninstall -g pm2-windows-startup >nul 2>&1
    echo ✅ PM2 eliminado completamente
)

echo.
echo ========================================================================
echo  🗑️  DESINSTALACION COMPLETADA EXITOSAMENTE
echo ========================================================================
echo.
echo ✅ Todos los servicios TicketConnector han sido eliminados
echo ✅ Auto-inicio removido de Windows  
echo ✅ Archivos temporales limpiados
if exist "config-backup*.json" echo ✅ Configuración respaldada
echo.
echo El proyecto sigue en: %CD%
echo Los archivos del código fuente NO fueron eliminados
echo.
echo Para reinstalar: Ejecuta install-automatico.bat como Administrador
echo Para soporte: https://conabsolute.com
echo.
echo ========================================================================
echo.
echo Gracias por usar TicketConnector - Conabsolute
pause