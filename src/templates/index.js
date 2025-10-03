// src/templates/index.js
const fs = require("fs");
const path = require("path");

const TEMPLATES_PATH = path.join(__dirname, "templates.json");

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
      "deliveryNotes",
      "envio",
      "subTotal",
      "descuentos",
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

  const merged = { ...DEFAULT_TEMPLATES, ...data };

  for (const [id, tpl] of Object.entries(merged)) {
    merged[id] = ensureTemplateShape(id, tpl);
  }

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

let templatesCache = loadTemplatesFromDisk();

function obtenerTodasLasPlantillas() {
  return JSON.parse(JSON.stringify(templatesCache));
}

function obtenerPlantilla(id) {
  return templatesCache[id] ? { ...templatesCache[id] } : null;
}

function guardarPlantilla(template) {
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

  if (templateId === "receipt") {
    if (!Array.isArray(data.detallePedido) || data.detallePedido.length === 0) {
      missing.push("detallePedido");
    } else {
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

    if (typeof data.total !== "number" || isNaN(data.total)) {
      missing.push("total");
    }

    if (
      typeof data.metodoPago !== "string" ||
      data.metodoPago.trim().length === 0
    ) {
      missing.push("metodoPago");
    }

    if (
      typeof data.telefono !== "string" ||
      data.telefono.trim().length === 0
    ) {
      missing.push("telefono");
    }
  } else if (templateId === "price-tag") {
    if (
      typeof data.productName !== "string" ||
      data.productName.trim().length === 0
    ) {
      missing.push("productName");
    }

    if (typeof data.price !== "number" || isNaN(data.price)) {
      missing.push("price");
    }
  }

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
