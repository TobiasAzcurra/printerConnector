// src/font-renderer/text-renderer.js
const fontRenderer = require("./index");
const fontCache = require("./cache");

/**
 * Capitaliza la primera letra de un texto y el resto en minúsculas
 * @param {string} texto - Texto a capitalizar
 * @returns {string} - Texto con la primera letra en mayúscula y el resto en minúsculas
 */
function capitalizarPrimeraLetra(texto) {
  if (!texto || texto.length === 0) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

/**
 * Renderiza texto como imagen, manejando múltiples líneas
 * @param {string} clienteId - ID del cliente
 * @param {string} texto - Texto a renderizar
 * @param {Object} options - Opciones de renderizado
 * @returns {Promise<Buffer>} - Imagen resultante como buffer
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
    // Si el texto contiene saltos de línea, dividirlo y renderizar cada línea
    if (texto.includes("\n")) {
      console.log("🔍 DEBUG: Texto contiene saltos de línea");
      const sharp = require("sharp");
      const lines = texto.split("\n").filter((line) => line.trim());

      console.log("🔍 Total líneas:", lines.length);
      console.log("🔍 Líneas:", lines);

      const lineBuffers = [];

      // Renderizar cada línea individualmente
      for (const line of lines) {
        const lineBuffer = await fontRenderer.textoAImagen(
          clienteId,
          line,
          options
        );
        lineBuffers.push(lineBuffer);
      }

      // Obtener dimensiones de cada línea
      const lineMetas = await Promise.all(
        lineBuffers.map((buf) => sharp(buf).metadata())
      );

      // Calcular dimensiones totales
      const maxWidth = Math.max(...lineMetas.map((m) => m.width));
      const totalHeight = lineMetas.reduce((sum, m) => sum + m.height, 0);
      const lineSpacing = 5; // Espaciado entre líneas
      const finalHeight = totalHeight + lineSpacing * (lines.length - 1);

      console.log("🔍 Dimensiones finales:", {
        maxWidth,
        finalHeight,
        totalLines: lines.length,
      });

      // Crear canvas compuesto
      const compositeOps = [];
      let currentY = 0;

      for (let i = 0; i < lineBuffers.length; i++) {
        const meta = lineMetas[i];
        compositeOps.push({
          input: lineBuffers[i],
          top: currentY,
          left: options.centerText
            ? Math.floor((maxWidth - meta.width) / 2)
            : 0,
        });
        currentY += meta.height + lineSpacing;
      }

      const imageBuffer = await sharp({
        create: {
          width: maxWidth,
          height: finalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      })
        .composite(compositeOps)
        .png()
        .toBuffer();

      fontCache.guardarEnCache(cacheKey, imageBuffer);
      console.log("✅ Imagen multilinea generada correctamente");
      return imageBuffer;
    }

    // Sin saltos de línea, renderizado simple
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

/**
 * Renderiza todas las partes de un ticket que requieren texto personalizado
 * @param {string} clienteId - ID del cliente
 * @param {Object} pedido - Datos del pedido
 * @returns {Promise<Object>} - Imágenes generadas para cada parte del ticket
 */
async function renderizarPartesTicket(clienteId, pedido) {
  const fontInfo = fontRenderer.obtenerInfoFuente(clienteId);
  if (!fontInfo) {
    throw new Error("No hay fuente personalizada configurada");
  }

  const imagenes = {};

  if (pedido.detallePedido && pedido.detallePedido.length > 0) {
    imagenes.productos = [];

    for (const item of pedido.detallePedido) {
      const nombre = item.name || item.nombre || "Producto";
      const cantidad = item.quantity || item.cantidad || 1;
      const precio = item.price || item.precio || 0;

      const nombreCapitalizado = capitalizarPrimeraLetra(nombre);
      const textoProducto = `${cantidad}x ${nombreCapitalizado}: $${
        precio * cantidad
      }`;

      const imgProducto = await renderizarTexto(clienteId, textoProducto, {
        fontSize: 28,
        centerText: false,
      });

      imagenes.productos.push(imgProducto);

      if (item.aclaraciones) {
        const imgAclaracion = await renderizarTexto(
          clienteId,
          `   ${item.aclaraciones}`,
          {
            fontSize: 28,
            centerText: false,
          }
        );

        imagenes.productos.push(imgAclaracion);
      }
    }
  }

  if (pedido.subTotal && pedido.subTotal !== pedido.total) {
    imagenes.subtotal = await renderizarTexto(
      clienteId,
      `SUBTOTAL: $${pedido.subTotal.toFixed(0)}`,
      { fontSize: 28, centerText: false }
    );
  }

  if (pedido.envio && pedido.envio > 0) {
    imagenes.envio = await renderizarTexto(
      clienteId,
      `ENVÍO: $${pedido.envio.toFixed(0)}`,
      { fontSize: 28, centerText: false }
    );
  }

  if (pedido.aclaraciones && !pedido.direccion) {
    imagenes.aclaracionesTitle = await renderizarTexto(
      clienteId,
      "ACLARACIONES:",
      { fontSize: 28, centerText: false }
    );

    imagenes.aclaracionesText = await renderizarTexto(
      clienteId,
      pedido.aclaraciones,
      { fontSize: 28, centerText: false }
    );
  }

  const textoClientePago = `$${pedido.total.toFixed(0)} en ${
    pedido.metodoPago
  } para el cliente ${pedido.telefono}`;
  imagenes.clientePago = await renderizarTexto(clienteId, textoClientePago, {
    fontSize: 28,
    centerText: true,
  });

  if (pedido.direccion) {
    imagenes.direccionTitle = await renderizarTexto(clienteId, "DIRECCIÓN:", {
      fontSize: 28,
      centerText: false,
    });

    imagenes.direccionText = await renderizarTexto(
      clienteId,
      pedido.direccion,
      { fontSize: 28, centerText: false }
    );

    if (pedido.aclaraciones) {
      imagenes.referenciaTitle = await renderizarTexto(
        clienteId,
        "REFERENCIA:",
        { fontSize: 28, centerText: false }
      );

      imagenes.referenciaText = await renderizarTexto(
        clienteId,
        pedido.aclaraciones,
        { fontSize: 28, centerText: false }
      );
    }
  }

  imagenes.footerEmpresa = await renderizarTexto(
    clienteId,
    "Absolute Soluciones Empresariales",
    { fontSize: 28, centerText: true, bold: true }
  );

  imagenes.footerWeb = await renderizarTexto(clienteId, "CONABSOLUTE.COM", {
    fontSize: 28,
    centerText: true,
    bold: true,
  });

  return imagenes;
}

module.exports = {
  renderizarTexto,
  renderizarPartesTicket,
};
