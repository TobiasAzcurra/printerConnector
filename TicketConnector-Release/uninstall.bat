@echo off 
title TicketConnector - Desinstalador 
echo Desinstalando TicketConnector... 
call pm2 stop ticket-web-server 
call pm2 stop ticket-service 
call pm2 delete ticket-web-server 
call pm2 delete ticket-service 
call pm2 save 
echo Sistema desinstalado correctamente 
pause 
