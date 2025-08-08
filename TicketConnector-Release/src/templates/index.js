// src/templates/index.js
const fs = require("fs");
const path = require("path");
const Mustache = require("mustache"); // Necesitaremos instalar esta dependencia

// Directorio para almacenar las plantillas
const TEMPLATES_DIR = path.join(__dirname, "..", "..", "templates");

// Asegurar que el directorio de plantillas existe
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  console.log("📁 Carpeta de plantillas creada");
}

// Plantillas predefinidas
const DEFAULT_TEMPLATES = {
  receipt: {
    id: "receipt",
    name: "Ticket de Venta",
    description: "Plantilla estándar para tickets de venta",
    width: 48,
    orientation: "portrait",
    requiredFields: ["detallePedido", "total", "metodoPago", "telefono"],
    optionalFields: ["aclaraciones", "direccion", "envio", "subTotal"],
    sections: {
      header: {
        showLogo: true,
        content: "{{businessName}}",
      },
      products: {
        itemFormat: "{{cantidad}}x {{nombre}}: ${{precio}}",
      },
      total: {
        content: "TOTAL: ${{total}}",
      },
      payment: {
        content: "${{total}} en {{metodoPago}} para el cliente {{telefono}}",
      },
      footer: {
        showLogo: true,
        content: "Gracias por su compra\nCONABSOLUTE.COM",
      },
    },
  },
  "price-tag": {
    id: "price-tag",
    name: "Etiqueta de Precio",
    description: "Para imprimir precios en góndola",
    width: 40,
    orientation: "landscape",
    requiredFields: ["productName", "price"],
    optionalFields: ["barcode", "offerPrice", "validUntil", "category"],
    sections: {
      header: {
        content: "{{businessName}}",
      },
      main: {
        content: "{{productName}}\n${{price}}",
      },
      footer: {
        content: "{{barcode}}",
      },
    },
  },
};

/**
 * Inicializa las plantillas predeterminadas si no existen
 */
function inicializarPlantillasPredeterminadas() {
  Object.values(DEFAULT_TEMPLATES).forEach((template) => {
    const templatePath = path.join(TEMPLATES_DIR, `${template.id}.json`);

    if (!fs.existsSync(templatePath)) {
      fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
      console.log(`✅ Plantilla predeterminada creada: ${template.name}`);
    }
  });
}

/**
 * Obtiene todas las plantillas disponibles
 * @returns {Object} - Objeto con todas las plantillas indexadas por ID
 */
function obtenerTodasLasPlantillas() {
  const templates = {};

  fs.readdirSync(TEMPLATES_DIR).forEach((file) => {
    if (file.endsWith(".json")) {
      try {
        const templatePath = path.join(TEMPLATES_DIR, file);
        const templateData = JSON.parse(fs.readFileSync(templatePath, "utf8"));
        templates[templateData.id] = templateData;
      } catch (err) {
        console.error(`❌ Error al cargar plantilla ${file}:`, err.message);
      }
    }
  });

  return templates;
}

/**
 * Obtiene una plantilla por su ID
 * @param {string} templateId - ID de la plantilla
 * @returns {Object|null} - Datos de la plantilla o null si no existe
 */
function obtenerPlantilla(templateId) {
  const templatePath = path.join(TEMPLATES_DIR, `${templateId}.json`);

  if (fs.existsSync(templatePath)) {
    try {
      return JSON.parse(fs.readFileSync(templatePath, "utf8"));
    } catch (err) {
      console.error(`❌ Error al leer plantilla ${templateId}:`, err.message);
      return null;
    }
  }

  return null;
}

/**
 * Guarda una nueva plantilla o actualiza una existente
 * @param {Object} template - Datos de la plantilla
 * @returns {boolean} - true si se guardó correctamente
 */
function guardarPlantilla(template) {
  if (!template || !template.id) {
    console.error("❌ Error: La plantilla debe tener un ID");
    return false;
  }

  try {
    const templatePath = path.join(TEMPLATES_DIR, `${template.id}.json`);
    fs.writeFileSync(templatePath, JSON.stringify(template, null, 2));
    console.log(`✅ Plantilla guardada: ${template.name || template.id}`);
    return true;
  } catch (err) {
    console.error(`❌ Error al guardar plantilla:`, err.message);
    return false;
  }
}

/**
 * Elimina una plantilla
 * @param {string} templateId - ID de la plantilla a eliminar
 * @returns {boolean} - true si se eliminó correctamente
 */
function eliminarPlantilla(templateId) {
  const templatePath = path.join(TEMPLATES_DIR, `${templateId}.json`);

  if (fs.existsSync(templatePath)) {
    try {
      fs.unlinkSync(templatePath);
      console.log(`✅ Plantilla eliminada: ${templateId}`);
      return true;
    } catch (err) {
      console.error(
        `❌ Error al eliminar plantilla ${templateId}:`,
        err.message
      );
      return false;
    }
  }

  return false;
}

/**
 * Valida que los datos proporcionados cumplan con los requisitos de la plantilla
 * @param {string} templateId - ID de la plantilla
 * @param {Object} data - Datos a validar
 * @returns {Object} - { valid: boolean, missingFields: string[] }
 */
function validarDatosParaPlantilla(templateId, data) {
  const template = obtenerPlantilla(templateId);

  if (!template) {
    return { valid: false, error: `Plantilla ${templateId} no encontrada` };
  }

  const missingFields = [];

  if (template.requiredFields) {
    template.requiredFields.forEach((field) => {
      if (
        !data.hasOwnProperty(field) ||
        data[field] === undefined ||
        data[field] === null
      ) {
        missingFields.push(field);
      }
    });
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    template,
  };
}

/**
 * Procesa datos con una plantilla específica para preparar la impresión
 * @param {string} templateId - ID de la plantilla
 * @param {Object} data - Datos para procesar
 * @returns {Object} - Datos procesados para impresión
 */
function procesarDatosConPlantilla(templateId, data) {
  const validacion = validarDatosParaPlantilla(templateId, data);

  if (!validacion.valid) {
    throw new Error(
      `Datos inválidos para plantilla ${templateId}. Campos faltantes: ${validacion.missingFields.join(
        ", "
      )}`
    );
  }

  // Combina los datos con la estructura de la plantilla
  // Aquí iría la lógica específica para cada tipo de plantilla
  // Por ahora solo devolvemos los datos tal cual
  return {
    ...data,
    template: validacion.template,
  };
}

// Inicializar plantillas predeterminadas
inicializarPlantillasPredeterminadas();

module.exports = {
  obtenerTodasLasPlantillas,
  obtenerPlantilla,
  guardarPlantilla,
  eliminarPlantilla,
  validarDatosParaPlantilla,
  procesarDatosConPlantilla,
};
