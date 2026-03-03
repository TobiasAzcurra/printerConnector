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
      if (!section.src) break;
      try {
        let buffer;
        if (section.src.startsWith("data:")) {
          // data:image/png;base64,<BASE64>
          const base64 = section.src.split(",")[1];
          buffer = Buffer.from(base64, "base64");
        } else {
          // raw base64 sin prefijo
          buffer = Buffer.from(section.src, "base64");
        }
        printer.alignCenter();
        await imprimirImagenBuffer(printer, buffer);
      } catch (err) {
        console.error(`❌ Error al imprimir imagen: ${err.message}`);
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

async function inicializarImpresora(config) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${config.printerIP}:${config.printerPort}`,
    width: config.ticketWidth || 48,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    encoding: "utf8",
  });

  const isConnected = await printer.isPrinterConnected();
  console.log("📡 Verificando conexión con impresora:", isConnected);
  if (!isConnected) {
    console.log("❌ No se pudo conectar con la impresora");
    return null;
  }
  return printer;
}

/**
 * Valida que el payload contenga un template con sections válidas.
 */
function validarDatosParaPlantilla(template) {
  if (!template || !Array.isArray(template.sections) || template.sections.length === 0) {
    return {
      valid: false,
      missingFields: ["_template.sections"],
      details: { message: "El payload no contiene _template.sections o está vacío" },
    };
  }
  return { valid: true, missingFields: [] };
}

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

  const validacion = validarDatosParaPlantilla(template);
  if (!validacion.valid) {
    console.error(`❌ Template inválido:`, validacion.missingFields);
    return false;
  }

  const printer = await inicializarImpresora(config);
  if (!printer) return false;

  const useFontTicket = config.useFontTicket === true;

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
    try {
      await renderSection(printer, section, config, useFontTicket);
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
