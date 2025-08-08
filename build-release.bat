@echo off
title TicketConnector - Generador de Paquete de Distribución
color 0B
echo.
echo ========================================================================
echo  TICKET CONNECTOR - GENERADOR DE PAQUETE PARA CLIENTES
echo  Crea un instalador único para distribuir a tus clientes
echo ========================================================================
echo.

REM Verificar que estamos en el directorio correcto
if not exist "web\server.js" (
    echo ❌ ERROR: Ejecuta este script desde el directorio raíz del proyecto
    pause
    exit /b
)

REM Crear directorio de release
set RELEASE_DIR=TicketConnector-Release
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"

echo 📦 Creando paquete de distribución...

REM Copiar archivos esenciales
echo   → Copiando archivos del proyecto...
xcopy "web" "%RELEASE_DIR%\web" /E /I /Q >nul
xcopy "src" "%RELEASE_DIR%\src" /E /I /Q >nul
copy "index.js" "%RELEASE_DIR%\" >nul
copy "package.json" "%RELEASE_DIR%\" >nul
copy "package-lock.json" "%RELEASE_DIR%\" >nul 2>nul

REM Copiar templates si existen
if exist "templates" xcopy "templates" "%RELEASE_DIR%\templates" /E /I /Q >nul

REM Usar el package.json original (que funciona) en lugar de generar uno nuevo
echo   → Copiando package.json original (con dependencias que funcionan)...
if exist "package.json" (
    copy "package.json" "%RELEASE_DIR%\" >nul
    echo   ✅ package.json copiado correctamente
) else (
    echo   ❌ ERROR: No se encontró package.json original
    echo   → Generando package.json básico...
    echo { > "%RELEASE_DIR%\package.json"
    echo   "name": "ticket-connector", >> "%RELEASE_DIR%\package.json"
    echo   "version": "2.0.0", >> "%RELEASE_DIR%\package.json"
    echo   "description": "Sistema de impresion termica profesional", >> "%RELEASE_DIR%\package.json"
    echo   "main": "index.js", >> "%RELEASE_DIR%\package.json"
    echo   "dependencies": {}, >> "%RELEASE_DIR%\package.json"
    echo   "author": "Conabsolute", >> "%RELEASE_DIR%\package.json"
    echo   "license": "ISC" >> "%RELEASE_DIR%\package.json"
    echo } >> "%RELEASE_DIR%\package.json"
    echo   ⚠️ Tendrás que instalar dependencias manualmente
)

REM Copiar instalador automático actualizado
copy "install-automatico.bat" "%RELEASE_DIR%\" >nul 2>nul
if not exist "%RELEASE_DIR%\install-automatico.bat" (
    echo   → Creando instalador automático...
    copy /y NUL "%RELEASE_DIR%\install-automatico.bat" >nul
    echo @echo off >> "%RELEASE_DIR%\install-automatico.bat"
    echo title TicketConnector - Instalacion Automatica >> "%RELEASE_DIR%\install-automatico.bat"
    echo echo Instalando TicketConnector... >> "%RELEASE_DIR%\install-automatico.bat"
    echo call npm install >> "%RELEASE_DIR%\install-automatico.bat"
    echo call npm install -g pm2@latest >> "%RELEASE_DIR%\install-automatico.bat"
    echo call pm2 start web\server.js --name ticket-web-server >> "%RELEASE_DIR%\install-automatico.bat"
    echo call pm2 start index.js --name ticket-service >> "%RELEASE_DIR%\install-automatico.bat"
    echo call pm2 save >> "%RELEASE_DIR%\install-automatico.bat"
    echo echo Sistema instalado correctamente >> "%RELEASE_DIR%\install-automatico.bat"
    echo start http://localhost:4040 >> "%RELEASE_DIR%\install-automatico.bat"
    echo pause >> "%RELEASE_DIR%\install-automatico.bat"
)

REM Copiar auto-configurador
copy "auto-config.js" "%RELEASE_DIR%\" >nul 2>nul

REM Crear scripts de utilidad
echo   → Creando scripts de utilidad...

REM Script de desinstalación
echo @echo off > "%RELEASE_DIR%\uninstall.bat"
echo title TicketConnector - Desinstalador >> "%RELEASE_DIR%\uninstall.bat"
echo echo Desinstalando TicketConnector... >> "%RELEASE_DIR%\uninstall.bat"
echo call pm2 stop ticket-web-server >> "%RELEASE_DIR%\uninstall.bat"
echo call pm2 stop ticket-service >> "%RELEASE_DIR%\uninstall.bat"
echo call pm2 delete ticket-web-server >> "%RELEASE_DIR%\uninstall.bat"
echo call pm2 delete ticket-service >> "%RELEASE_DIR%\uninstall.bat"
echo call pm2 save >> "%RELEASE_DIR%\uninstall.bat"
echo echo Sistema desinstalado correctamente >> "%RELEASE_DIR%\uninstall.bat"
echo pause >> "%RELEASE_DIR%\uninstall.bat"

REM Script de estado
echo @echo off > "%RELEASE_DIR%\status.bat"
echo title TicketConnector - Estado del Sistema >> "%RELEASE_DIR%\status.bat"
echo call pm2 status >> "%RELEASE_DIR%\status.bat"
echo echo. >> "%RELEASE_DIR%\status.bat"
echo echo Interfaz web: http://localhost:4040 >> "%RELEASE_DIR%\status.bat"
echo pause >> "%RELEASE_DIR%\status.bat"

REM Script de logs
echo @echo off > "%RELEASE_DIR%\ver-logs.bat"
echo title TicketConnector - Logs del Sistema >> "%RELEASE_DIR%\ver-logs.bat"
echo call pm2 logs --lines 50 >> "%RELEASE_DIR%\ver-logs.bat"
echo pause >> "%RELEASE_DIR%\ver-logs.bat"

REM Crear manual de usuario
echo   → Generando documentación...
echo TICKETCONNECTOR - MANUAL DE USUARIO > "%RELEASE_DIR%\MANUAL.txt"
echo ========================================= >> "%RELEASE_DIR%\MANUAL.txt"
echo. >> "%RELEASE_DIR%\MANUAL.txt"
echo INSTALACION: >> "%RELEASE_DIR%\MANUAL.txt"
echo 1. Ejecutar como Administrador: install-automatico.bat >> "%RELEASE_DIR%\MANUAL.txt"
echo 2. Esperar que termine la instalacion >> "%RELEASE_DIR%\MANUAL.txt"
echo 3. Se abrira automaticamente la interfaz web >> "%RELEASE_DIR%\MANUAL.txt"
echo. >> "%RELEASE_DIR%\MANUAL.txt"
echo CONFIGURACION: >> "%RELEASE_DIR%\MANUAL.txt"
echo 1. Configurar IP de impresora en la pestana "Conexion" >> "%RELEASE_DIR%\MANUAL.txt"
echo 2. Configurar datos del negocio en "Ticket" >> "%RELEASE_DIR%\MANUAL.txt"
echo 3. Subir logos en "Logos" (opcional) >> "%RELEASE_DIR%\MANUAL.txt"
echo 4. Hacer prueba de impresion >> "%RELEASE_DIR%\MANUAL.txt"
echo. >> "%RELEASE_DIR%\MANUAL.txt"
echo ARCHIVOS INCLUIDOS: >> "%RELEASE_DIR%\MANUAL.txt"
echo - install-automatico.bat: Instalador principal >> "%RELEASE_DIR%\MANUAL.txt"
echo - uninstall.bat: Desinstalador >> "%RELEASE_DIR%\MANUAL.txt"
echo - status.bat: Ver estado del sistema >> "%RELEASE_DIR%\MANUAL.txt"
echo - ver-logs.bat: Ver logs de error >> "%RELEASE_DIR%\MANUAL.txt"
echo. >> "%RELEASE_DIR%\MANUAL.txt"
echo SOPORTE: https://conabsolute.com >> "%RELEASE_DIR%\MANUAL.txt"

REM Crear README para desarrolladores
echo   → Creando documentación técnica...
echo # TicketConnector - Sistema de Impresión Térmica > "%RELEASE_DIR%\README.md"
echo. >> "%RELEASE_DIR%\README.md"
echo ## Instalación Automática >> "%RELEASE_DIR%\README.md"
echo. >> "%RELEASE_DIR%\README.md"
echo 1. Ejecutar como Administrador: `install-automatico.bat` >> "%RELEASE_DIR%\README.md"
echo 2. El sistema se instala y configura automáticamente >> "%RELEASE_DIR%\README.md"
echo 3. Se inicia automáticamente con Windows >> "%RELEASE_DIR%\README.md"
echo. >> "%RELEASE_DIR%\README.md"
echo ## API de Uso >> "%RELEASE_DIR%\README.md"
echo. >> "%RELEASE_DIR%\README.md"
echo ```bash >> "%RELEASE_DIR%\README.md"
echo # Imprimir ticket de venta >> "%RELEASE_DIR%\README.md"
echo curl -X POST http://localhost:4040/api/imprimir \ >> "%RELEASE_DIR%\README.md"
echo   -H "Content-Type: application/json" \ >> "%RELEASE_DIR%\README.md"
echo   -d '{"detallePedido": [{"nombre": "Producto", "cantidad": 1, "precio": 100}], "total": 100, "metodoPago": "efectivo", "telefono": "123456"}' >> "%RELEASE_DIR%\README.md"
echo ``` >> "%RELEASE_DIR%\README.md"
echo. >> "%RELEASE_DIR%\README.md"
echo ## Gestión del Sistema >> "%RELEASE_DIR%\README.md"
echo. >> "%RELEASE_DIR%\README.md"
echo - **Interfaz Web:** http://localhost:4040 >> "%RELEASE_DIR%\README.md"
echo - **Ver Estado:** `status.bat` >> "%RELEASE_DIR%\README.md"
echo - **Ver Logs:** `ver-logs.bat` >> "%RELEASE_DIR%\README.md"
echo - **Desinstalar:** `uninstall.bat` >> "%RELEASE_DIR%\README.md"

REM Crear archivo de versión
echo   → Generando información de versión...
echo { > "%RELEASE_DIR%\version.json"
echo   "version": "2.0.0", >> "%RELEASE_DIR%\version.json"
echo   "buildDate": "%DATE%", >> "%RELEASE_DIR%\version.json"
echo   "buildTime": "%TIME%", >> "%RELEASE_DIR%\version.json"
echo   "features": [ >> "%RELEASE_DIR%\version.json"
echo     "Auto-instalación completa", >> "%RELEASE_DIR%\version.json"
echo     "Auto-detección de impresoras", >> "%RELEASE_DIR%\version.json"
echo     "Configuración automática", >> "%RELEASE_DIR%\version.json"
echo     "Plantillas múltiples", >> "%RELEASE_DIR%\version.json"
echo     "Logos personalizables", >> "%RELEASE_DIR%\version.json"
echo     "Fuentes personalizadas", >> "%RELEASE_DIR%\version.json"
echo     "Impresión por lotes", >> "%RELEASE_DIR%\version.json"
echo     "API REST completa" >> "%RELEASE_DIR%\version.json"
echo   ] >> "%RELEASE_DIR%\version.json"
echo } >> "%RELEASE_DIR%\version.json"

REM Crear empaquetado final
echo   → Creando archivo comprimido...
if exist "TicketConnector-v2.0.zip" del "TicketConnector-v2.0.zip"

REM Usar PowerShell para comprimir si está disponible
powershell -Command "Compress-Archive -Path '%RELEASE_DIR%\*' -DestinationPath 'TicketConnector-v2.0.zip'" >nul 2>&1

if exist "TicketConnector-v2.0.zip" (
    echo ✅ Paquete creado: TicketConnector-v2.0.zip
) else (
    echo ⚠️ No se pudo crear ZIP automáticamente
    echo ✅ Paquete listo en carpeta: %RELEASE_DIR%
)

echo.
echo ========================================================================
echo  🎉 PAQUETE DE DISTRIBUCION COMPLETADO
echo ========================================================================
echo.
echo Archivos generados:
echo ✅ Carpeta: %RELEASE_DIR%
if exist "TicketConnector-v2.0.zip" echo ✅ ZIP: TicketConnector-v2.0.zip
echo.
echo El paquete incluye:
echo 🚀 Instalador automático completo
echo 🔧 Scripts de gestión (status, logs, uninstall)
echo 📖 Manual de usuario y documentación técnica
echo 🎯 Auto-detección de impresoras
echo ⚙️ Configuración automática
echo.
echo COMO ENTREGAR A CLIENTES:
echo 1. Enviar el archivo ZIP o carpeta completa
echo 2. Instrucciones: "Ejecutar install-automatico.bat como Administrador"
echo 3. El sistema se instala y configura solo
echo 4. Se abre automáticamente la interfaz de configuración
echo.
echo ========================================================================
pause