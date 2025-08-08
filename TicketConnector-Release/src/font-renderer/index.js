// src/font-renderer/index.js
const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");
const sharp = require("sharp");

// Directorio base para almacenar fuentes y caché
const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "fonts");

// Asegurar que el directorio de fuentes existe
if (!fs.existsSync(FONTS_DIR)) {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

/**
 * Registra una fuente en el sistema
 * @param {string} clienteId - ID del cliente
 * @param {string} fontPath - Ruta al archivo TTF
 * @returns {Promise<Object>} - Información de la fuente registrada
 */
async function registrarFuente(clienteId, fontPath) {
  // Crear directorio del cliente si no existe
  const clientDir = path.join(FONTS_DIR, clienteId);
  if (!fs.existsSync(clientDir)) {
    fs.mkdirSync(clientDir, { recursive: true });
  }

  // Generar nombre único para la fuente
  const fontName = `custom-${clienteId}-${Date.now()}`;
  const destPath = path.join(clientDir, `${fontName}.ttf`);

  // Copiar archivo de fuente
  fs.copyFileSync(fontPath, destPath);

  // Validar fuente con opentype.js
  try {
    const font = opentype.loadSync(destPath);

    // Generar un archivo de metadatos para guardar info de la fuente
    const metadataPath = path.join(clientDir, "font-metadata.json");
    const metadata = {
      fontName,
      fontPath: destPath,
      fontFamily:
        font.names.fontFamily.en || font.names.fontFamily.es || "CustomFont",
      dateAdded: new Date().toISOString(),
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(
      `✅ Fuente "${metadata.fontFamily}" registrada como ${fontName}`
    );

    return metadata;
  } catch (err) {
    console.error("❌ Error al validar la fuente:", err);
    // Si hay error, eliminar el archivo copiado
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    throw new Error(`Archivo de fuente inválido: ${err.message}`);
  }
}

/**
 * Convierte texto a una imagen SVG usando la fuente personalizada
 * @param {string} clienteId - ID del cliente
 * @param {string} texto - Texto a convertir
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<string>} - SVG como string
 */
async function textoASvg(clienteId, texto, options = {}) {
  const {
    fontSize = 28,
    centerText = false,
    backgroundColor = null,
    textColor = "#000000",
    padding = 10,
  } = options;

  // Obtener info de la fuente
  const fontInfo = obtenerInfoFuente(clienteId);
  if (!fontInfo) {
    throw new Error(`No hay fuente registrada para el cliente ${clienteId}`);
  }

  // Cargar la fuente
  const font = opentype.loadSync(fontInfo.fontPath);

  // Medir el texto para determinar tamaño del SVG
  const path = font.getPath(texto, 0, 0, fontSize);
  const pathBounds = path.getBoundingBox();

  // Calcular dimensiones
  const width = Math.ceil(pathBounds.x2 - pathBounds.x1) + padding * 2;
  const height = Math.ceil(pathBounds.y2 - pathBounds.y1) + padding * 2;

  // Ajustar posición del texto
  let textX = padding - pathBounds.x1;
  if (centerText) {
    textX = width / 2 - (pathBounds.x2 - pathBounds.x1) / 2 - pathBounds.x1;
  }

  const textY = padding - pathBounds.y1;

  // Crear SVG
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  // Agregar fondo si se especifica
  if (backgroundColor) {
    svg += `<rect width="100%" height="100%" fill="${backgroundColor}" />`;
  }

  // Agregar el texto
  svg += `<path d="${font
    .getPath(texto, textX, textY, fontSize)
    .toPathData()}" fill="${textColor}" />`;

  svg += "</svg>";

  return svg;
}

/**
 * Convierte texto a una imagen PNG usando la fuente personalizada
 * @param {string} clienteId - ID del cliente
 * @param {string} texto - Texto a convertir
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Buffer>} - Imagen resultante como buffer
 */
async function textoAImagen(clienteId, texto, options = {}) {
  try {
    // Generar SVG
    const svg = await textoASvg(clienteId, texto, options);

    // Convertir SVG a PNG usando sharp
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    return pngBuffer;
  } catch (err) {
    console.error(`Error al convertir texto a imagen: ${err.message}`);
    throw err;
  }
}

/**
 * Obtiene la información de la fuente de un cliente
 * @param {string} clienteId - ID del cliente
 * @returns {Object|null} - Metadata de la fuente o null si no hay
 */
function obtenerInfoFuente(clienteId) {
  const clientDir = path.join(FONTS_DIR, clienteId);
  const metadataPath = path.join(clientDir, "font-metadata.json");

  if (fs.existsSync(metadataPath)) {
    // Leer los metadatos
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

    // Actualizar la ruta de la fuente para que siempre use la ruta actual
    const fontName = metadata.fontPath.split("\\").pop(); // Extraer el nombre del archivo
    metadata.fontPath = path.join(clientDir, fontName);

    return metadata;
  }

  return null;
}

/**
 * Elimina la fuente de un cliente
 * @param {string} clienteId - ID del cliente
 * @returns {boolean} - true si se eliminó correctamente
 */
function eliminarFuente(clienteId) {
  const clientDir = path.join(FONTS_DIR, clienteId);

  if (fs.existsSync(clientDir)) {
    fs.rmSync(clientDir, { recursive: true, force: true });
    return true;
  }

  return false;
}

module.exports = {
  registrarFuente,
  textoASvg,
  textoAImagen,
  obtenerInfoFuente,
  eliminarFuente,
};
