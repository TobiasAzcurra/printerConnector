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
function validarDatosParaPlantilla(template) {
  if (!template || !Array.isArray(template.sections) || template.sections.length === 0) {
    return {
      valid: false,
      missingFields: ["_template.sections"],
      details: { message: "El payload no contiene _template.sections o está vacío" },
    };
  }

  const TIPOS_VALIDOS = new Set(["text", "image", "spacer"]);
  const invalidas = template.sections
    .map((s, i) => (!s.type || !TIPOS_VALIDOS.has(s.type) ? `sections[${i}].type` : null))
    .filter(Boolean);

  return {
    valid: invalidas.length === 0,
    missingFields: invalidas,
  };
}

module.exports = {
  validarDatosParaPlantilla,
};
