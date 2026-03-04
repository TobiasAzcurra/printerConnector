# PrinterConnector — Guía de integración para el frontend

Este conector corre en la máquina del cliente junto a la impresora térmica. Su único trabajo es recibir un job de impresión, renderizarlo y mandarlo a la impresora. **No conoce templates propios** — el frontend define completamente qué y cómo se imprime.

---

## Setup (nueva instalación)

```bash
# 1. Clonar el repo
git clone <url-del-repo>
cd printerConnector

# 2. Instalar dependencias
npm install

# 3. Crear la configuración local
cp config.example.json config.json
# Editar config.json con la IP de la impresora y el clienteId correspondiente

# 4. Levantar los procesos

# Opción A — desarrollo (dos terminales separadas)
node web/server.js
node index.js

# Opción B — producción con PM2 (un solo comando, autoarranque con Windows)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save

# Para autoarranque al iniciar Windows:
npm install -g pm2-windows-startup
pm2-startup install
```

> **Requisitos:** Node.js 18+. La impresora debe estar en la misma red local y accesible por TCP en el puerto configurado (default: 9100).

Una vez levantado, la configuración (IP, logos, fuente TTF) se gestiona desde el panel web en `conabsolute.com`.

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
  "_templateInfo": {
    "id": "ticket-cocina"
  },
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

El conector **imprime las secciones en el orden exacto en que las recibe**, de arriba hacia abajo.

---

## Tipos de sección

| type | Descripción | Campos requeridos | Campos opcionales |
|---|---|---|---|
| `text` | Una línea de texto | `text` (string) | `style` |
| `image` | Una imagen | `src` (base64 data URI o raw base64) | — |
| `spacer` | Línea en blanco | — | — |

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
  "details": "Campos faltantes o invalidos: sections",
  "hint": "El payload debe incluir _template.sections con tipo text, image o spacer"
}
```

---

## Ejemplo completo — ticket de cocina

```json
{
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
- IP y puerto de la impresora
- Logo de cabecera y pie
- Fuente TTF personalizada (si se usa `useFontTicket`)
