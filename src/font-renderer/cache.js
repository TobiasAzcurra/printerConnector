// src/font-renderer/cache.js
//
// Caché de imágenes PNG por fuente.
//
// Estructura en disco:
//   assets/fonts/cache/<fontSha12>/<cacheKey>.png
//
// Beneficios:
//   - Cambiar de fuente no contamina el caché de la anterior.
//   - Evictar la fuente vieja = borrar un directorio entero, sin tocar nada más.
//   - No hay archivos fantasma de fuentes anteriores.

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_DIR = path.join(__dirname, "..", "..", "assets", "fonts", "cache");

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function fontDir(fontVersion) {
  // Usar los primeros 12 chars del sha como nombre de carpeta (suficientemente único)
  const tag = (fontVersion || "default").slice(0, 12);
  return path.join(CACHE_DIR, tag);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Genera la clave MD5 para una entrada del caché.
 * fontVersion se excluye del hash — está representado en el directorio.
 */
function generarClaveCaching(clienteId, texto, options = {}) {
  const { fontVersion, ...rest } = options;
  return crypto
    .createHash("md5")
    .update(JSON.stringify({ clienteId, texto, options: rest }))
    .digest("hex");
}

/** Verifica si hay una entrada en caché para la fuente activa. */
function existeEnCache(fontVersion, cacheKey) {
  return fs.existsSync(path.join(fontDir(fontVersion), `${cacheKey}.png`));
}

/** Lee una entrada del caché. Devuelve Buffer o null. */
function obtenerDeCache(fontVersion, cacheKey) {
  const p = path.join(fontDir(fontVersion), `${cacheKey}.png`);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

/** Guarda una entrada en el caché de la fuente activa. */
function guardarEnCache(fontVersion, cacheKey, imageBuffer) {
  const dir = fontDir(fontVersion);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${cacheKey}.png`), imageBuffer);
}

/**
 * Borra los directorios de fuentes anteriores.
 * Llamar al subir una fuente nueva o al arrancar el conector.
 * @param {string} currentFontVersion - sha256 de la fuente activa
 */
function evictarFuentesAnteriores(currentFontVersion) {
  const currentTag = (currentFontVersion || "default").slice(0, 12);
  try {
    fs.readdirSync(CACHE_DIR).forEach((entry) => {
      if (entry !== currentTag) {
        fs.rmSync(path.join(CACHE_DIR, entry), { recursive: true, force: true });
        console.log(`Cache: directorio de fuente vieja eliminado: ${entry}`);
      }
    });
  } catch (err) {
    console.error("Cache: error al evictar fuentes anteriores:", err.message);
  }
}

module.exports = {
  generarClaveCaching,
  existeEnCache,
  obtenerDeCache,
  guardarEnCache,
  evictarFuentesAnteriores,
};
