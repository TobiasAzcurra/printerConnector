# PrinterConnector — Guía de integración para el frontend

Este conector corre en la máquina del cliente junto a la impresora térmica. Su único trabajo es recibir un job de impresión, renderizarlo y mandarlo a la impresora. **No conoce templates propios** — el frontend define completamente qué y cómo se imprime.

---

## Instalación en local de cliente

### Paso 1 — Prerequisitos en la PC del cliente

- Instalar **Node.js 18+**: https://nodejs.org → LTS → Windows Installer
- Verificar: abrir CMD y correr `node -v` (debe mostrar v18 o superior)

### Paso 2 — Copiar el conector

```bash
git clone <url-del-repo>
cd printerConnector
npm install
```

> Si la PC no tiene Git, copiar la carpeta por pendrive. Igual hay que correr `npm install` adentro.

### Paso 3 — Conseguir los valores de configuración

Antes de tocar la PC del cliente, tener estos datos a mano:

| Valor | Dónde conseguirlo |
|---|---|
| `enterpriseId` | Firebase Console → Firestore → colección `absoluteClientes` → el ID del documento de la empresa |
| `sucursalId` | Dentro del doc de la empresa → subcolección `sucursales` → el ID del documento |
| `apiKey` | Dentro del doc de la sucursal → campo `printerApiKey` |
| `confirmPrintUrl` | Firebase Console → Functions → buscar `confirmPrint` → copiar la URL |
| `clienteId` | Slug del cliente, cualquier string sin espacios (ej: `"anhelo"`) |

### Paso 4 — Crear la configuración

```bash
cp config.example.json config.json
```

Editar `config.json` con los valores del paso anterior. Ejemplo:

```json
{
  "enterpriseId": "abc123",
  "sucursalId": "xyz789",
  "apiKey": "la-api-key-de-la-sucursal",
  "confirmPrintUrl": "https://us-central1-absolute-97d92.cloudfunctions.net/confirmPrint",
  "clienteId": "nombre-del-cliente",
  "printerIP": "192.168.1.100",
  "printerPort": 9100,
  "useHeaderLogo": true,
  "useFooterLogo": true,
  "useFontTicket": false,
  "ticketWidth": 48,
  "connectorSecret": "",
  "assets": {}
}
```

> `printerIP` se puede dejar en `""` por ahora — se completa después. `connectorSecret` se genera automáticamente al primer arranque.

### Paso 5 — Encontrar la IP de la impresora

La impresora debe estar encendida y conectada a la red del local.

**Opción A — desde la propia impresora:** Imprimir una hoja de configuración (generalmente manteniendo presionado el botón de avance de papel al encender). La IP aparece impresa.

**Opción B — desde CMD en la PC del cliente:**
```cmd
arp -a
```
Buscar en la lista una IP en el rango de la red local (ej: `192.168.1.x`). Probar conectividad:
```cmd
Test-NetConnection -ComputerName 192.168.1.100 -Port 9100
```
Si `TcpTestSucceeded` dice `True`, esa es la impresora.

Una vez confirmada la IP, escribirla en `config.json` → campo `printerIP`.

### Paso 6 — Levantar con PM2 (producción)

```bash
npm install -g pm2
npm install -g pm2-windows-startup
pm2 start ecosystem.config.js
pm2 save
pm2-startup install
```

Esto levanta el conector automáticamente cada vez que enciende la PC, sin necesidad de abrir ninguna terminal.

### Paso 7 — Verificar que todo funciona

**1. Verificar que el conector está corriendo:**
```bash
pm2 status
```
Ambos procesos (`printer-web` y `printer-connector`) deben estar en estado `online`.

**2. Verificar la config desde el navegador:**

Abrir `http://localhost:4040/api/config` — debe devolver un JSON con los datos de configuración (sin el `connectorSecret`).

**3. Verificar conectividad con la impresora:**

Abrir `http://localhost:4040` — el panel web muestra el estado de la red. Desde ahí se pueden subir logos y la fuente TTF.

**4. Mandar un ticket de prueba:**

Desde la UI del frontend, presionar "Imprimir" en cualquier pedido. Si el ticket sale, la instalación es correcta.

**5. Verificar logs en caso de error:**
```bash
pm2 logs printer-connector --lines 50
pm2 logs printer-web --lines 50
```

### Comandos útiles de PM2

```bash
pm2 status                        # Ver estado de todos los procesos
pm2 logs printer-connector        # Ver logs en tiempo real
pm2 restart printer-connector     # Reiniciar el conector (ej: después de cambiar config)
pm2 restart all                   # Reiniciar todo
pm2 stop all                      # Detener todo
```

> **Firewall de Windows:** Si el frontend corre en otra PC de la red y no puede conectarse al conector, agregar una regla de entrada en Windows Defender Firewall para el puerto TCP 4040.

---

## Setup rápido (desarrollo local)

```bash
git clone <url-del-repo>
cd printerConnector
npm install
cp config.example.json config.json
# Completar los valores en config.json (ver sección anterior)

# Levantar en dos terminales separadas
node web/server.js
node index.js
```

---

## Cómo enviar un job

### Opción A — HTTP REST (recomendada para producción)

```
POST http://<ip-del-cliente>:4040/api/imprimir
Content-Type: application/json
```

### Opción B — Socket.io (real-time)

Emitir el evento `"imprimir"` al backend, quien lo redirige al conector vía socket.

---

## Estructura del payload

```json
{
  "_printer": {
    "ip": "192.168.1.100",
    "port": 9100,
    "width": 48
  },
  "_templateInfo": {
    "id": "ticket-cocina",
    "jobId": "1711234567890-abc123",
    "logId": "uuid-del-printlog-en-firestore"
  },
  "orderId": "uuid-del-pedido",
  "printerName": "Cocina",
  "_template": {
    "sections": [
      { "type": "image",  "src": "data:image/png;base64,..." },
      { "type": "spacer" },
      { "type": "text",   "text": "2x Hamburguesa", "style": { "align": "center", "fontSize": 28, "bold": true } },
      { "type": "text",   "text": "Sin cebolla",     "style": { "align": "center", "fontSize": 24 } },
      { "type": "spacer" },
      { "type": "text",   "text": "Total: $3.000",   "style": { "align": "center", "fontSize": 28, "bold": true } },
      { "type": "spacer" }
    ]
  }
}
```

| Campo | Requerido | Descripción |
|---|---|---|
| `_printer.ip` | ✅ | IP de la impresora térmica en la red local |
| `_printer.port` | — | Puerto TCP (default: `9100`) |
| `_printer.width` | — | Ancho del papel en caracteres (`48` o `32`, default: `48`) |
| `_templateInfo.id` | ✅ | Identificador del template (para logs) |
| `_templateInfo.jobId` | ✅ | ID único del job — usado para tracking en WebSocket |
| `_templateInfo.logId` | ✅ | ID del documento `printLogs` en Firestore — el conector lo confirma vía Cloud Function |
| `orderId` | ✅ | ID del pedido — propagado en todos los eventos WebSocket |
| `printerName` | ✅ | Nombre de la impresora — propagado en eventos WebSocket para identificarla en el frontend |
| `_template.sections` | ✅ | Array de secciones a imprimir, en orden |

El conector **imprime las secciones en el orden exacto en que las recibe**, de arriba hacia abajo.

---

## Tipos de sección

| type | Descripción | Campos requeridos | Campos opcionales |
|---|---|---|---|
| `text` | Una línea de texto | `text` (string) | `style` |
| `image` | Una imagen | `src` (base64 data URI o raw base64) | — |
| `spacer` | Línea en blanco | — | — |
| `icon-text` | Ícono PNG + texto en la misma línea | `iconSrc` (base64), `text` (string) | `style`, `iconSize`, `iconPosition` (`"left"` \| `"right"`), `align` |

---

## Opciones de estilo para `text`

```json
"style": {
  "align":    "center",  // "left" | "center" | "right"  (default: "center")
  "fontSize": 28,        // número en pts. Valores típicos: 24, 28, 32
  "bold":     true       // true | false  (default: false)
}
```

> Si `useFontTicket` está activo en el conector, el texto se renderiza con la fuente TTF personalizada del cliente.  
> Si no está activo, se imprime en texto plano ESC/POS con las opciones de estilo disponibles.

---

## Imágenes

El campo `src` acepta:
- **data URI**: `"data:image/png;base64,<base64>"`
- **base64 crudo**: `"<base64>"` (sin prefijo)

```json
{ "type": "image", "src": "data:image/png;base64,iVBORw0KGgo..." }
```

**Tips:**
- El ancho máximo útil es ~580px (el conector redimensiona si es necesario).
- Preferir imágenes en escala de grises o monocromáticas — las impresoras térmicas no imprimen color.
- PNG sin fondo (transparente) funciona correctamente.

---

## Respuesta del endpoint

**Éxito (`200`):**
```json
{
  "success": true,
  "jobId": "1711234567890-abc123",
  "queueSnapshot": {
    "position": 1,
    "total": 1,
    "pending": 0,
    "processing": 1
  }
}
```

**Error de validación (`400`):**
```json
{
  "error": "Payload invalido",
  "details": "Campos faltantes o invalidos: _printer.ip",
  "hint": "El payload debe incluir _printer.ip y _template.sections con tipo text, image o spacer"
}
```

---

## Eventos WebSocket

El conector emite eventos vía Socket.io al servidor web (`localhost:4040`), que los reenvía al frontend conectado.

| Evento | Cuándo se emite | Payload principal |
|---|---|---|
| `queue-update` | Cada vez que cambia el estado de la cola | `{ pending, processing, completed, failed, total, enqueued }` |
| `job-queued` | Cuando un job entra a la cola | `{ jobId, orderId, printerName, position }` |
| `job-processing` | Cuando el worker empieza a procesar (incluye reintentos) | `{ jobId, orderId, printerName, attempt }` |
| `job-success` | Cuando el ticket imprimió correctamente | `{ jobId, orderId, printerName, logId }` |
| `job-error` | Cuando se agotan los reintentos y el job falla definitivamente | `{ jobId, orderId, printerName, logId, error }` |

El frontend usa `logId` de `job-success` y `job-error` para saber si puede cambiar el estado del pedido y para habilitar la reimpresión selectiva.

---

## Ejemplo completo — ticket de cocina

```json
{
  "_printer": {
    "ip": "192.168.1.102",
    "port": 9100,
    "width": 48
  },
  "_templateInfo": { "id": "ticket-cocina" },
  "_template": {
    "sections": [
      { "type": "image",  "src": "data:image/png;base64,<LOGO_BASE64>" },
      { "type": "spacer" },
      { "type": "text",   "text": "=== COCINA ===",             "style": { "align": "center", "fontSize": 28, "bold": true } },
      { "type": "text",   "text": "Mesa 4 — 14:30",             "style": { "align": "center", "fontSize": 24 } },
      { "type": "spacer" },
      { "type": "text",   "text": "2x Hamburguesa clásica",     "style": { "align": "left",   "fontSize": 28, "bold": true } },
      { "type": "text",   "text": "   Sin cebolla",             "style": { "align": "left",   "fontSize": 24 } },
      { "type": "text",   "text": "1x Papas fritas",            "style": { "align": "left",   "fontSize": 28, "bold": true } },
      { "type": "spacer" },
      { "type": "text",   "text": "--------------------------------", "style": { "align": "center" } },
      { "type": "text",   "text": "Total: $3.000 en Efectivo",  "style": { "align": "center", "fontSize": 28, "bold": true } },
      { "type": "spacer" }
    ]
  }
}
```

---

## Reglas del frontend

- **El conector no formatea ni capitaliza.** Lo que mandás es lo que se imprime. Si querés `"2x Hamburguesa clásica"`, mandás ese string exacto.
- **Las listas ya deben estar armadas.** Si tenés `detallePedido = [...]`, iterás en el front y generás una sección `text` por ítem.
- **Los logos van como base64.** Leés el archivo (o lo tenés en memoria), lo convertís a `data:image/png;base64,...` y lo mandás como sección `image`.
- **El orden importa.** El conector imprime sección por sección en el orden del array.

---

## Configuración en el cliente

El panel de administración local está en `http://localhost:4040`. Desde ahí se configura:
- Logo de cabecera y pie general.
- Fuente TTF personalizada (si se usa `useFontTicket`).
- ID de Cliente.

> **¡Importante!** Ya no se configuran IPs en el conector. El ruteo hacia múltiples impresoras (barra, cocina, caja) lo domina directamente el payload del frontend en la propiedad `_printer`.

---

## Monitoreo y análisis de logs de impresión

Cada intento de impresión queda registrado en Firestore bajo:
```
absoluteClientes/{enterpriseId}/sucursales/{sucursalId}/printLogs
```

El script `conabsolute/src/migration/export-print-logs.js` exporta todos los logs de todas las empresas en un rango de fechas, genera un resumen en consola y guarda un JSON para análisis posterior.

### Requisito único: service account de Firebase

1. Ir a Firebase Console → ⚙️ Configuración del proyecto → **Cuentas de servicio**
2. Hacer click en **Generar nueva clave privada**
3. Guardar el archivo como `serviceAccountKey.json` en la raíz de `conabsolute/`

> ⚠️ `serviceAccountKey.json` está en `.gitignore` — nunca se commitea.

### Uso

```bash
# Desde la raíz de conabsolute/
node src/migration/export-print-logs.js --from 2026-03-01 --to 2026-03-09

# Si el service account está en otra ruta:
node src/migration/export-print-logs.js --from 2026-03-01 --to 2026-03-09 --key /ruta/a/serviceAccountKey.json
```

El script imprime en consola:
- Total de logs por estado (`sent`, `printed`, `error`, `failed_printer`)
- Top 10 errores más frecuentes
- Impresoras con más fallos definitivos

Y genera un archivo `print-logs-export-<from>-a-<to>.json` en el directorio actual.

### Analizar con Claude

Correr el script, copiar el contenido del JSON y pegarlo a Claude con este prompt:

> Analizá este export de printLogs de mi sistema de impresión. Quiero saber: tasa de éxito por empresa y por impresora, errores más frecuentes, impresoras problemáticas, y pedidos que nunca se imprimieron correctamente (tienen `error` o `failed_printer` pero no tienen un `printed` posterior con el mismo `orderId`).

### Estructura de cada documento en `printLogs`

| Campo | Descripción |
|---|---|
| `status` | `sent` → en vuelo \| `printed` → confirmado físicamente \| `error` → falló al encolar \| `failed_printer` → reintentos agotados |
| `timestamp` | Cuándo se encoló |
| `trigger` | `manual` (botón imprimir) \| `auto` (AutoPrintEngine) |
| `event` | `ORDER_CREATED` \| `STATUS_CHANGED` (solo trigger auto) |
| `statusTo` | Estado al que cambió el pedido (solo STATUS_CHANGED) |
| `templateName` | Nombre del template de ticket |
| `terminalName` | Nombre de la impresora destino |
| `printScope` | `order` \| `item` |
| `orderId` | ID del pedido |
| `errorMessage` | Mensaje de error (solo si falló) |
