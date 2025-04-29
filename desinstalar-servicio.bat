@echo off
echo Desinstalando servicio de impresion de tickets...

REM Detenemos los servicios
echo Deteniendo servicios...
call pm2 stop ticket-web-server
call pm2 stop ticket-service

REM Eliminamos los servicios de PM2
echo Eliminando servicios...
call pm2 delete ticket-web-server
call pm2 delete ticket-service

REM Guardamos la configuracion
echo Guardando configuracion...
call pm2 save

REM Eliminamos PM2 del inicio automatico
echo Eliminando inicio automatico...
call pm2 unstartup

echo.
echo Desinstalacion completada! El servicio ya no se iniciara automaticamente.
echo.
pause