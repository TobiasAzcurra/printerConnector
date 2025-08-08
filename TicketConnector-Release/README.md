# TicketConnector - Sistema de Impresión Térmica 
 
## Instalación Automática 
 
1. Ejecutar como Administrador: `install-automatico.bat` 
2. El sistema se instala y configura automáticamente 
3. Se inicia automáticamente con Windows 
 
## API de Uso 
 
```bash 
# Imprimir ticket de venta 
curl -X POST http://localhost:4040/api/imprimir \ 
  -H "Content-Type: application/json" \ 
  -d '{"detallePedido": [{"nombre": "Producto", "cantidad": 1, "precio": 100}], "total": 100, "metodoPago": "efectivo", "telefono": "123456"}' 
``` 
 
## Gestión del Sistema 
 
- **Interfaz Web:** http://localhost:4040 
- **Ver Estado:** `status.bat` 
- **Ver Logs:** `ver-logs.bat` 
- **Desinstalar:** `uninstall.bat` 
