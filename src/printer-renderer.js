// src/printer-renderer.js
const fs = require("fs");
const path = require("path");
const {
  printer: ThermalPrinter,
  types: PrinterTypes,
} = require("node-thermal-printer");
const fontRenderer = require("./font-renderer");
const textRenderer = require("./font-renderer/text-renderer");

const tempDir = path.join(__dirname, "..", "temp");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escribe un buffer como archivo temporal, lo imprime y lo elimina.
 */
async function imprimirImagenBuffer(printer, buffer) {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `img-${Date.now()}.png`);
  try {
    fs.writeFileSync(tempPath, buffer);
    await printer.printImage(tempPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

/**
 * Aplica alineamiento al printer.
 * @param {Object} printer
 * @param {"left"|"center"|"right"} align
 */
function applyAlign(printer, align) {
  switch (align) {
    case "right":  printer.alignRight();  break;
    case "left":   printer.alignLeft();   break;
    default:       printer.alignCenter(); break;
  }
}

/**
 * Imprime texto con el style dado.
 * Si useFontTicket está activo renderiza como imagen; con fallback a texto plano.
 */
async function printText(printer, text, style = {}, config, useFontTicket) {
  const { align = "center", fontSize = 28, bold = false } = style;

  applyAlign(printer, align);
  if (bold) printer.bold(true);

  if (useFontTicket) {
    try {
      const buffer = await textRenderer.renderizarTexto(config.clienteId, text, {
        fontSize,
        centerText: align === "center",
        bold,
        // Incluir sha de la fuente en el cache key: si cambia la fuente,
        // cambia la clave y se ignoran los PNG viejos automáticamente.
        fontVersion: config.assets?.font?.sha256 || "default",
        maxWidthPx: config.paperWidthPx,
      });
      await imprimirImagenBuffer(printer, buffer);
    } catch (err) {
      console.error(`❌ Error al renderizar texto con fuente: ${err.message}`);
      printer.println(text);
    }
  } else {
    printer.println(text);
  }

  if (bold) printer.bold(false);
}

// ---------------------------------------------------------------------------
// Section renderers (3 primitivas)
// ---------------------------------------------------------------------------

/**
 * Renderiza una sección.
 * Tipos soportados: "text" | "image" | "spacer"
 */
async function renderSection(printer, section, config, useFontTicket) {
  switch (section.type) {

    // ── text ─────────────────────────────────────────────────────────────
    case "text": {
      if (!section.text && section.text !== 0) break;
      await printText(printer, String(section.text), section.style || {}, config, useFontTicket);
      break;
    }

    // ── image ─────────────────────────────────────────────────────────────
    // El frontend manda la imagen como base64 (data URI o raw base64 string).
    case "image": {
      if (!section.src) { console.warn("📷 [image] src vacío — saltando"); break; }
      const srcType = section.src.startsWith("data:") ? "data-URI" : section.src.startsWith("http") ? "URL" : "raw-base64";
      console.log(`📷 [image] procesando — tipo: ${srcType}`);
      try {
        let rawBuffer;
        if (section.src.startsWith("data:")) {
          rawBuffer = Buffer.from(section.src.split(",")[1], "base64");
        } else if (section.src.startsWith("http")) {
          // URL fallback: fetch from Node.js (no CORS restrictions)
          const res = await fetch(section.src);
          if (!res.ok) throw new Error(`HTTP ${res.status} al descargar imagen`);
          rawBuffer = Buffer.from(await res.arrayBuffer());
        } else {
          rawBuffer = Buffer.from(section.src, "base64");
        }
        // node-thermal-printer only supports PNG (uses pngjs internally).
        // Convert via sharp so JPEG and other formats work too.
        const sharp = require("sharp");
        const pngBuffer = await sharp(rawBuffer).png().toBuffer();
        applyAlign(printer, section.align ?? "center");
        await imprimirImagenBuffer(printer, pngBuffer);
        console.log(`📷 [image] OK — enviado a impresora`);
      } catch (err) {
        console.error(`❌ Error al imprimir imagen: ${err.message}`, err.stack);
      }
      break;
    }

    // ── icon-text ─────────────────────────────────────────────────────────
    // Renders icon + text side-by-side as a single bitmap image.
    // When useFontTicket is true: text is rendered with the custom font via
    // textRenderer, then composited with the icon using sharp.
    // When useFontTicket is false: falls back to separate image + text sections.
    case "icon-text": {
      const iconPosition    = section.iconPosition || "left";
      const iconSize        = section.iconSize || 40;
      const align           = section.align || section.style?.align || "center";
      const iconVerticalAlign = section.iconVerticalAlign || "middle";

      // Decode icon buffer
      let iconBuffer = null;
      if (section.iconSrc) {
        try {
          const sharp = require("sharp");
          let rawBuffer;
          if (section.iconSrc.startsWith("data:")) {
            rawBuffer = Buffer.from(section.iconSrc.split(",")[1], "base64");
          } else {
            rawBuffer = Buffer.from(section.iconSrc, "base64");
          }
          iconBuffer = await sharp(rawBuffer)
            .resize(iconSize, iconSize, {
              fit: "contain",
              background: { r: 255, g: 255, b: 255, alpha: 255 },
            })
            .png()
            .toBuffer();
        } catch (err) {
          console.error(`❌ Error decodificando icono icon-text: ${err.message}`);
        }
      }

      if (useFontTicket && section.text) {
        // Render text as PNG with custom font, then composite with icon
        try {
          const sharp = require("sharp");
          const gap = 8;
          const textMaxWidthPx = config.paperWidthPx
            ? config.paperWidthPx - iconSize - gap
            : undefined;
          const textBuffer = await textRenderer.renderizarTexto(config.clienteId, section.text, {
            fontSize:    section.style?.fontSize || 24,
            centerText:  false,
            bold:        section.style?.bold || false,
            fontVersion: config.assets?.font?.sha256 || "default",
            maxWidthPx:  textMaxWidthPx,
          });

          if (textBuffer && iconBuffer) {
            const textMeta = await sharp(textBuffer).metadata();
            const gap = 8;
            const totalWidth  = iconSize + gap + textMeta.width;
            const totalHeight = Math.max(iconSize, textMeta.height);
            const textTop  = Math.floor((totalHeight - textMeta.height) / 2);
            const iconTop  = iconVerticalAlign === "top" ? 0 : Math.floor((totalHeight - iconSize) / 2);

            const compositeOps = iconPosition === "left"
              ? [
                  { input: iconBuffer, top: iconTop, left: 0 },
                  { input: textBuffer, top: textTop, left: iconSize + gap },
                ]
              : [
                  { input: textBuffer, top: textTop, left: 0 },
                  { input: iconBuffer, top: iconTop, left: textMeta.width + gap },
                ];

            const combined = await sharp({
              create: {
                width:      totalWidth,
                height:     totalHeight,
                channels:   4,
                background: { r: 255, g: 255, b: 255, alpha: 255 },
              },
            })
              .composite(compositeOps)
              .png()
              .toBuffer();

            applyAlign(printer, align);
            await imprimirImagenBuffer(printer, combined);
          } else if (textBuffer) {
            applyAlign(printer, align);
            await imprimirImagenBuffer(printer, textBuffer);
          } else if (iconBuffer) {
            applyAlign(printer, align);
            await imprimirImagenBuffer(printer, iconBuffer);
          }
        } catch (err) {
          console.error(`❌ Error compositing icon-text: ${err.message}`);
          // Fallback: icon then text separately
          if (iconBuffer) {
            printer.alignCenter();
            await imprimirImagenBuffer(printer, iconBuffer);
          }
          if (section.text) {
            await printText(printer, section.text, section.style || {}, config, useFontTicket);
          }
        }
      } else {
        // No custom font — print icon and text as separate sections
        if (iconPosition === "left") {
          if (iconBuffer) { applyAlign(printer, align); await imprimirImagenBuffer(printer, iconBuffer); }
          if (section.text) await printText(printer, section.text, section.style || {}, config, false);
        } else {
          if (section.text) await printText(printer, section.text, section.style || {}, config, false);
          if (iconBuffer) { applyAlign(printer, align); await imprimirImagenBuffer(printer, iconBuffer); }
        }
      }
      break;
    }

    // ── spacer ────────────────────────────────────────────────────────────
    case "spacer": {
      printer.newLine();
      break;
    }

    default: {
      console.warn(`⚠️  Tipo de sección desconocido: "${section.type}"`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

async function inicializarImpresora(printerConfig) {
  const ip = printerConfig.ip;
  const port = printerConfig.port || 9100;
  const width = printerConfig.width || 48;

  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${ip}:${port}`,
    width: width,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    encoding: "utf8",
  });

  console.log(`📡 Conectando a impresora en ${ip}:${port}...`);
  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    console.log(`❌ No se pudo conectar con la impresora en ${ip}:${port}`);
    return null;
  }
  return printer;
}

/**
 * Valida que el payload contenga un template con sections válidas.
 */
function validarDatosParaPlantilla(data) {
  const template = data._template;
  const printer  = data._printer;

  if (!printer || !printer.ip) {
    return {
      valid: false,
      missingFields: ["_printer.ip"],
      details: { message: "El payload debe especificar la IP de destino en _printer.ip" },
    };
  }

  if (!template || !Array.isArray(template.sections) || template.sections.length === 0) {
    return {
      valid: false,
      missingFields: ["_template.sections"],
      details: { message: "El payload no contiene _template.sections o está vacío" },
    };
  }
  return { valid: true, missingFields: [] };
}

// Ancho de papel térmico en pixels a 203 DPI (estándar Epson/Star).
// Se usa para el wrap pixel-aware en fuentes personalizadas.
// 80mm (48 cols) → 576px total, ~556px descontando márgenes laterales.
// 58mm (32 cols) → 384px total, ~364px descontando márgenes laterales.
const PAPER_WIDTH_PX = {
  48: 556,
  32: 364,
};

/**
 * Punto de entrada principal.
 * Itera las sections del template y las renderiza en orden.
 *
 * @param {Object} config
 * @param {Object} data     - payload del trabajo (solo se usa config aquí)
 * @param {Object} template - { sections: [...] }
 * @returns {Promise<boolean>}
 */
async function imprimirConPlantilla(config, data, template) {
  const templateId = data._templateInfo?.id || "desconocido";
  console.log(`📝 Imprimiendo template: ${templateId} (${template.sections.length} secciones)`);

  const validacion = validarDatosParaPlantilla(data);
  if (!validacion.valid) {
    console.error(`❌ Template o destino inválido:`, validacion.missingFields);
    return false;
  }

  const printerDest = data._printer;
  const printer = await inicializarImpresora(printerDest);
  if (!printer) return false;

  const useFontTicket = config.useFontTicket === true;
  const paperWidthPx = PAPER_WIDTH_PX[printerDest.width] ?? PAPER_WIDTH_PX[48];
  const enrichedConfig = { ...config, paperWidthPx };

  if (useFontTicket) {
    try {
      const fontInfo = fontRenderer.obtenerInfoFuente(config.clienteId);
      if (fontInfo) {
        console.log(`🔤 Fuente personalizada: ${fontInfo.fontFamily || fontInfo.fontName}`);
      } else {
        console.warn("⚠️ Fuente personalizada activada pero no encontrada");
      }
    } catch (err) {
      console.error("❌ Error al preparar fuente:", err.message);
    }
  }

  for (const section of template.sections) {
    console.log(`  → sección: ${section.type}${section.type === "image" ? ` (src: ${section.src ? section.src.substring(0, 40) : "VACÍO"})` : ""}`);
    try {
      await renderSection(printer, section, enrichedConfig, useFontTicket);
    } catch (err) {
      console.error(`❌ Error en sección "${section.type}":`, err.message);
      // Sigue con el resto aunque una sección falle
    }
  }

  printer.cut();

  try {
    await printer.execute();
    console.log(`✅ Impresión completada: ${templateId}`);
    return true;
  } catch (err) {
    console.error(`❌ Error al ejecutar impresión:`, err);
    return false;
  }
}

module.exports = {
  imprimirConPlantilla,
  validarDatosParaPlantilla,
};
