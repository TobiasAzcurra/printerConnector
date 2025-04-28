// src/font-renderer/text-renderer.js - Modificado para renderizar todos los textos

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
 * Renderiza texto como imagen, utilizando caché para optimizar
 * @param {string} clienteId - ID del cliente
 * @param {string} texto - Texto a renderizar
 * @param {Object} options - Opciones de renderizado
 * @returns {Promise<Buffer>} - Imagen resultante como buffer
 */
async function renderizarTexto(clienteId, texto, options = {}) {
  // Si el texto está vacío, devolver null
  if (!texto || texto.trim().length === 0) {
    return null;
  }

  // Generar clave de caché
  const cacheKey = fontCache.generarClaveCaching(clienteId, texto, options);

  // Verificar si existe en caché
  if (fontCache.existeEnCache(cacheKey)) {
    console.log(
      `🔍 Usando caché para "${texto.substring(0, 20)}${
        texto.length > 20 ? "..." : ""
      }"`
    );
    return fontCache.obtenerDeCache(cacheKey);
  }

  // Si no está en caché, renderizar
  console.log(
    `🖌️ Renderizando texto: "${texto.substring(0, 20)}${
      texto.length > 20 ? "..." : ""
    }"`
  );

  try {
    const imageBuffer = await fontRenderer.textoAImagen(
      clienteId,
      texto,
      options
    );

    // Guardar en caché para futuros usos
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
  // Verificar si existe fuente para el cliente
  const fontInfo = fontRenderer.obtenerInfoFuente(clienteId);
  if (!fontInfo) {
    throw new Error("No hay fuente personalizada configurada");
  }

  const imagenes = {};

  // PRODUCTOS - cada producto como una imagen separada
  if (pedido.detallePedido && pedido.detallePedido.length > 0) {
    imagenes.productos = [];

    for (const item of pedido.detallePedido) {
      const nombre = item.name || item.nombre || "Producto";
      const cantidad = item.quantity || item.cantidad || 1;
      const precio = item.price || item.precio || 0;

      // Aplicar capitalización al nombre del producto
      const nombreCapitalizado = capitalizarPrimeraLetra(nombre);
      const textoProducto = `${cantidad}x ${nombreCapitalizado}: $${
        precio * cantidad
      }`;

      const imgProducto = await renderizarTexto(clienteId, textoProducto, {
        fontSize: 28,
        centerText: false,
      });

      imagenes.productos.push(imgProducto);

      // Aclaraciones del producto
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

  // SUBTOTAL
  if (pedido.subTotal && pedido.subTotal !== pedido.total) {
    imagenes.subtotal = await renderizarTexto(
      clienteId,
      `SUBTOTAL: $${pedido.subTotal.toFixed(0)}`,
      { fontSize: 28, centerText: false }
    );
  }

  // ENVÍO
  if (pedido.envio && pedido.envio > 0) {
    imagenes.envio = await renderizarTexto(
      clienteId,
      `ENVÍO: $${pedido.envio.toFixed(0)}`,
      { fontSize: 28, centerText: false }
    );
  }

  // ACLARACIONES GENERALES
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

  // DATOS DE CLIENTE/PAGO
  const textoClientePago = `$${pedido.total.toFixed(0)} en ${
    pedido.metodoPago
  } para el cliente ${pedido.telefono}`;
  imagenes.clientePago = await renderizarTexto(clienteId, textoClientePago, {
    fontSize: 28,
    centerText: true,
  });

  // DIRECCIÓN PARA DELIVERY
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

    // Referencia de dirección
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

  // TEXTOS DE PIE DE PÁGINA
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
