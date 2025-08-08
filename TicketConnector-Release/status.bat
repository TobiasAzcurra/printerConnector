@echo off 
title TicketConnector - Estado del Sistema 
call pm2 status 
echo. 
echo Interfaz web: http://localhost:4040 
pause 
