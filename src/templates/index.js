// src/templates/index.js
// Sistema de plantillas y validación de datos

const fs = require("fs");
const path = require("path");

const TEMPLATES_PATH = path.join(__dirname, "templates.json");

// Plantillas por defecto (se mezclan/crean en disco si no existe el archivo)
const DEFAULT_TEMPLATES = {
  receipt: {
    id: "receipt",
    name: "Ticket de Venta",
    description: "Plantilla estándar para tickets de venta",
    version: 1,
    requiredFields: ["detallePedido", "total", "metodoPago", "telefono"],
    optionalFields: [
      "aclaraciones",
      "direccion",
      "envio",
      "subTotal",
      "fecha",
      "hora",
      "businessName",
      "id",
    ],
  },
  "price-tag": {
    id: "price-tag",
    name: "Etiqueta de Precio",
    description: "Para imprimir precios en góndola",
    version: 1,
    requiredFields: ["productName", "price"],
    optionalFields: [
      "barcode",
      "offerPrice",
      "validUntil",
      "category",
      "header",
      "businessName",
    ],
  },
};

/**
 * Lee el archivo de plantillas si existe, de lo contrario crea uno con los defaults.
 * Además asegura retrocompatibilidad (campos mínimos por plantilla).
 */
function loadTemplatesFromDisk() {
  let data = {};
  if (fs.existsSync(TEMPLATES_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(TEMPLATES_PATH, "utf8")) || {};
    } catch (e) {
      console.warn(
        "⚠️  templates.json corrupto o ilegible, se regenerará con defaults."
      );
      data = {};
    }
  }

  // Mezclar con defaults sin pisar personalizaciones existentes
  const merged = { ...DEFAULT_TEMPLATES, ...data };

  // Asegurar campos obligatorios en cada plantilla
  for (const [id, tpl] of Object.entries(merged)) {
    merged[id] = ensureTemplateShape(id, tpl);
  }

  // Guardar si no existía o estaba corrupto
  saveTemplatesToDisk(merged);
  return merged;
}

function saveTemplatesToDisk(templates) {
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

function ensureTemplateShape(id, tpl) {
  const base = DEFAULT_TEMPLATES[id] || {};
  return {
    id: tpl.id || id,
    name: tpl.name || base.name || id,
    description: tpl.description || base.description || "",
    version: typeof tpl.version === "number" ? tpl.version : base.version || 1,
    requiredFields: Array.isArray(tpl.requiredFields)
      ? tpl.requiredFields
      : base.requiredFields || [],
    optionalFields: Array.isArray(tpl.optionalFields)
      ? tpl.optionalFields
      : base.optionalFields || [],
  };
}

// Estado en memoria (se inicializa al requerir el módulo)
let templatesCache = loadTemplatesFromDisk();

/**
 * API pública
 */

function obtenerTodasLasPlantillas() {
  // Devolver copia inmutable
  return JSON.parse(JSON.stringify(templatesCache));
}

function obtenerPlantilla(id) {
  return templatesCache[id] ? { ...templatesCache[id] } : null;
}

function guardarPlantilla(template) {
  // Validaciones mínimas
  if (!template || !template.id) return false;

  const normalized = ensureTemplateShape(template.id, template);
  templatesCache[normalized.id] = normalized;

  try {
    saveTemplatesToDisk(templatesCache);
    return true;
  } catch (e) {
    console.error("❌ Error al guardar plantilla:", e);
    return false;
  }
}

function eliminarPlantilla(id) {
  if (!templatesCache[id]) return false;

  // Evitar que se borren las dos base por accidente
  const isBase = id === "receipt" || id === "price-tag";
  if (isBase) {
    console.warn(`⚠️ No se permite eliminar la plantilla base "${id}"`);
    return false;
  }

  delete templatesCache[id];
  try {
    saveTemplatesToDisk(templatesCache);
    return true;
  } catch (e) {
    console.error("❌ Error al eliminar plantilla:", e);
    return false;
  }
}

/**
 * Valida los datos que llegan a /api/imprimir contra la plantilla seleccionada.
 * Devuelve { valid: boolean, missingFields: string[], details?: object }
 */
function validarDatosParaPlantilla(templateId, data) {
  const tpl = obtenerPlantilla(templateId);
  if (!tpl) {
    return {
      valid: false,
      missingFields: [":templateId inválido"],
      details: { message: `No existe plantilla con id "${templateId}"` },
    };
  }

  const missing = [];

  // Reglas específicas por plantilla (para una validación más útil)
  if (templateId === "receipt") {
    // detallePedido: array [{ nombre, cantidad, precio }]
    if (!Array.isArray(data.detallePedido) || data.detallePedido.length === 0) {
      missing.push("detallePedido");
    } else {
      // Validación básica de cada ítem
      const invalidLines = [];
      data.detallePedido.forEach((item, idx) => {
        if (
          !item ||
          typeof item.nombre !== "string" ||
          item.nombre.trim() === "" ||
          typeof item.cantidad !== "number" ||
          isNaN(item.cantidad) ||
          typeof item.precio !== "number" ||
          isNaN(item.precio)
        ) {
          invalidLines.push(idx);
        }
      });
      if (invalidLines.length > 0) {
        missing.push(`detallePedido.items(${invalidLines.join(",")})`);
      }
    }

    // total
    if (typeof data.total !== "number" || isNaN(data.total)) {
      missing.push("total");
    }

    // metodoPago
    if (
      typeof data.metodoPago !== "string" ||
      data.metodoPago.trim().length === 0
    ) {
      missing.push("metodoPago");
    }

    // telefono
    if (
      typeof data.telefono !== "string" ||
      data.telefono.trim().length === 0
    ) {
      missing.push("telefono");
    }
  } else if (templateId === "price-tag") {
    // productName
    if (
      typeof data.productName !== "string" ||
      data.productName.trim().length === 0
    ) {
      missing.push("productName");
    }

    // price
    if (typeof data.price !== "number" || isNaN(data.price)) {
      missing.push("price");
    }

    // header es opcional (batch), no se valida como requerido
  }

  // Validación genérica en base a requiredFields declarados por la plantilla
  // (solo para campos simples que no hayamos validado específicamente arriba)
  const alreadyChecked = new Set([
    ...(templateId === "receipt"
      ? ["detallePedido", "total", "metodoPago", "telefono"]
      : []),
    ...(templateId === "price-tag" ? ["productName", "price"] : []),
  ]);

  for (const field of tpl.requiredFields) {
    if (alreadyChecked.has(field)) continue;

    if (
      data[field] === undefined ||
      data[field] === null ||
      (typeof data[field] === "string" && data[field].trim() === "")
    ) {
      // Evitar duplicados si ya fue detectado
      if (!missing.includes(field)) missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missingFields: missing,
  };
}

module.exports = {
  obtenerTodasLasPlantillas,
  obtenerPlantilla,
  guardarPlantilla,
  eliminarPlantilla,
  validarDatosParaPlantilla,
};
