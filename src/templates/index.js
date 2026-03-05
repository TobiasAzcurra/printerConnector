// src/templates/index.js
//
// Con el nuevo modelo de 3 primitivas (text | image | spacer),
// toda la lógica de armado del ticket vive en el frontend.
// Este módulo solo valida que el payload contenga un _template.sections válido.

/**
 * Valida que el template tenga sections y que cada sección tenga un type conocido.
 *
 * @param {Object} template - { sections: [...] }
 * @returns {{ valid: boolean, missingFields: string[] }}
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

  const TIPOS_VALIDOS = new Set(["text", "image", "spacer"]);
  const invalidas = template.sections
    .map((s, i) => (!s.type || !TIPOS_VALIDOS.has(s.type) ? `_template.sections[${i}].type` : null))
    .filter(Boolean);

  return {
    valid: invalidas.length === 0,
    missingFields: invalidas,
  };
}

module.exports = {
  validarDatosParaPlantilla,
};
