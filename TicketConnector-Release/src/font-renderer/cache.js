// src/font-renderer/cache.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Directorio para el caché
const CACHE_DIR = path.join(__dirname, "..", "..", "assets", "fonts", "cache");

// Asegurar que el directorio de caché existe
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Genera una clave única para la entrada del caché
 * @param {string} clienteId - ID del cliente
 * @param {string} texto - El texto a convertir en imagen
 * @param {Object} options - Opciones de renderizado
 * @returns {string} - Clave única para el caché
 */
function generarClaveCaching(clienteId, texto, options = {}) {
  // Combinar todos los parámetros relevantes
  const dataToHash = JSON.stringify({
    clienteId,
    texto,
    options,
  });

  // Generar hash como clave
  return crypto.createHash("md5").update(dataToHash).digest("hex");
}

/**
 * Verifica si una entrada existe en el caché
 * @param {string} cacheKey - Clave del caché
 * @returns {boolean} - true si existe en caché
 */
function existeEnCache(cacheKey) {
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.png`);
  return fs.existsSync(cachePath);
}

/**
 * Obtiene una entrada del caché
 * @param {string} cacheKey - Clave del caché
 * @returns {Buffer|null} - Buffer de la imagen o null si no existe
 */
function obtenerDeCache(cacheKey) {
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.png`);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  return null;
}

/**
 * Guarda una entrada en el caché
 * @param {string} cacheKey - Clave del caché
 * @param {Buffer} imageBuffer - Buffer de la imagen
 */
function guardarEnCache(cacheKey, imageBuffer) {
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.png`);
  fs.writeFileSync(cachePath, imageBuffer);
}

/**
 * Limpia entradas antiguas del caché
 * @param {number} maxAgeMs - Edad máxima en milisegundos (por defecto 7 días)
 */
function limpiarCache(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const ahora = Date.now();

  fs.readdirSync(CACHE_DIR).forEach((file) => {
    const filePath = path.join(CACHE_DIR, file);
    const stats = fs.statSync(filePath);

    // Si el archivo es más antiguo que maxAgeMs, eliminarlo
    if (ahora - stats.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filePath);
    }
  });
}

module.exports = {
  generarClaveCaching,
  existeEnCache,
  obtenerDeCache,
  guardarEnCache,
  limpiarCache,
};
