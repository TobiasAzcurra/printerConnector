// src/font-renderer/text-renderer.js
const fontRenderer = require("./index");
const fontCache = require("./cache");



/**
 * Renderiza texto como imagen PNG usando la fuente personalizada del cliente.
 * Soporta múltiples líneas (separadas por \n) y caché de resultados.
 *
 * @param {string} clienteId
 * @param {string} texto
 * @param {Object} options - { fontSize, centerText, bold }
 * @returns {Promise<Buffer>} - PNG como buffer
 */
async function renderizarTexto(clienteId, texto, options = {}) {
  if (!texto || texto.trim().length === 0) {
    return null;
  }

  const cacheKey = fontCache.generarClaveCaching(clienteId, texto, options);

  if (fontCache.existeEnCache(cacheKey)) {
    console.log(
      `🔍 Usando caché para "${texto.substring(0, 20)}${
        texto.length > 20 ? "..." : ""
      }"`
    );
    return fontCache.obtenerDeCache(cacheKey);
  }

  console.log(
    `🖌️ Renderizando texto: "${texto.substring(0, 20)}${
      texto.length > 20 ? "..." : ""
    }"`
  );

  try {
    // Texto con saltos de línea → renderizar cada línea y componer verticalmente
    if (texto.includes("\n")) {
      const sharp = require("sharp");
      const lines = texto.split("\n").filter((line) => line.trim());

      const lineBuffers = await Promise.all(
        lines.map((line) => fontRenderer.textoAImagen(clienteId, line, options))
      );

      const lineMetas = await Promise.all(
        lineBuffers.map((buf) => sharp(buf).metadata())
      );

      const maxWidth = Math.max(...lineMetas.map((m) => m.width));
      const lineSpacing = 5;
      const totalHeight =
        lineMetas.reduce((sum, m) => sum + m.height, 0) +
        lineSpacing * (lines.length - 1);

      let currentY = 0;
      const compositeOps = lineBuffers.map((buf, i) => {
        const op = {
          input: buf,
          top: currentY,
          left: options.centerText
            ? Math.floor((maxWidth - lineMetas[i].width) / 2)
            : 0,
        };
        currentY += lineMetas[i].height + lineSpacing;
        return op;
      });

      const imageBuffer = await sharp({
        create: {
          width: maxWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      })
        .composite(compositeOps)
        .png()
        .toBuffer();

      fontCache.guardarEnCache(cacheKey, imageBuffer);
      return imageBuffer;
    }

    // Texto sin saltos de línea → renderizado simple
    const imageBuffer = await fontRenderer.textoAImagen(
      clienteId,
      texto,
      options
    );

    fontCache.guardarEnCache(cacheKey, imageBuffer);
    return imageBuffer;
  } catch (err) {
    console.error(`❌ Error al renderizar texto: ${err.message}`);
    throw err;
  }
}

module.exports = {
  renderizarTexto,
};
