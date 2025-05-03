// src/printer-renderer.js
const fs = require("fs");
const path = require("path");
const {
  printer: ThermalPrinter,
  types: PrinterTypes,
} = require("node-thermal-printer");
const fontRenderer = require("./font-renderer");
const fontCache = require("./font-renderer/cache");
const textRenderer = require("./font-renderer/text-renderer");
const templateSystem = require("./templates");

// Ruta para guardar imágenes temporales
const tempFontImagePath = path.join(__dirname, "..", "temp-font-image.png");
const logoHeaderPath = path.join(__dirname, "..", "assets", "logo-header.png");
const logoFooterPath = path.join(__dirname, "..", "assets", "logo-footer.png");

// Función para formatear montos como currency sin decimales
function formatCurrency(amount) {
  return `$${Number(amount).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Función auxiliar para guardar buffer de imagen en archivo temporal e imprimirlo
 * @param {Object} printer - Instancia de la impresora
 * @param {Buffer} imageBuffer - Buffer de la imagen a imprimir
 * @returns {Promise<boolean>} - true si se imprimió correctamente
 */
async function imprimirImagenTexto(printer, imageBuffer) {
  try {
    // Crear un nombre único para evitar conflictos
    const tempPath = `${tempFontImagePath.replace(
      ".png",
      ""
    )}-${Date.now()}.png`;

    // Guardar buffer en archivo temporal
    fs.writeFileSync(tempPath, imageBuffer);

    // Imprimir la imagen desde el archivo
    await printer.printImage(tempPath);

    // Eliminar el archivo temporal después de usarlo
    fs.unlinkSync(tempPath);

    return true;
  } catch (err) {
    console.error(`Error al imprimir imagen: ${err.message}`);
    return false;
  }
}

/**
 * Inicializa una instancia de impresora con la configuración dada
 * @param {Object} config - Configuración de la impresora
 * @returns {Promise<Object>} - Instancia de la impresora o null si hay error
 */
async function inicializarImpresora(config) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${config.printerIP}:${config.printerPort}`,
    width: config.ticketWidth || 48,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    encoding: "utf8",
  });

  const isConnected = await printer.isPrinterConnected();
  console.log("📡 Verificando conexión con impresora:", isConnected);

  if (!isConnected) {
    console.log("❌ No se pudo conectar con la impresora");
    return null;
  }

  return printer;
}

/**
 * Imprime un contenido basado en una plantilla específica
 * @param {Object} config - Configuración del sistema
 * @param {Object} data - Datos a imprimir
 * @param {string} templateId - ID de la plantilla a utilizar
 * @returns {Promise<boolean>} - true si se imprimió correctamente
 */
async function imprimirConPlantilla(config, data, templateId = "receipt") {
  console.log(`📝 Imprimiendo con plantilla: ${templateId}`);

  try {
    // Validar datos con la plantilla
    const validacion = templateSystem.validarDatosParaPlantilla(
      templateId,
      data
    );

    if (!validacion.valid) {
      console.error(
        `❌ Datos inválidos para plantilla ${templateId}:`,
        validacion.missingFields
      );
      return false;
    }

    const template = validacion.template;
    const printer = await inicializarImpresora(config);

    if (!printer) {
      return false;
    }

    // Verificar si se debe usar fuente personalizada
    const useFontTicket = config.useFontTicket === true;
    let fontImages = null;

    // Si está activada la fuente personalizada, preparar imágenes
    if (useFontTicket) {
      try {
        // Obtener info de la fuente
        const fontInfo = fontRenderer.obtenerInfoFuente(config.clienteId);
        if (fontInfo) {
          console.log(
            `🔤 Usando fuente personalizada: ${
              fontInfo.fontFamily || fontInfo.fontName
            }`
          );
        } else {
          console.log("⚠️ Fuente personalizada activada pero no encontrada");
        }
      } catch (err) {
        console.error(
          "❌ Error al preparar fuente personalizada:",
          err.message
        );
      }
    }

    // Renderizar según el tipo de plantilla
    switch (templateId) {
      case "receipt":
        await imprimirTicketVenta(printer, data, config, useFontTicket);
        break;
      case "price-tag":
        await imprimirEtiquetaPrecio(printer, data, config, useFontTicket);
        break;

      default:
        console.error(`❌ Tipo de plantilla no soportado: ${templateId}`);
        return false;
    }

    return true;
  } catch (err) {
    console.error(`❌ Error al imprimir con plantilla ${templateId}:`, err);
    return false;
  }
}

/**
 * Imprime un ticket de venta (plantilla original)
 */
async function imprimirTicketVenta(printer, pedido, config, useFontTicket) {
  const sharp = require("sharp");
  const path = require("path");
  const fs = require("fs");

  // ENCABEZADO DEL TICKET
  if (config.useHeaderLogo && fs.existsSync(logoHeaderPath)) {
    try {
      console.log("📷 Imprimiendo logo de encabezado...");
      await printer.printImage(logoHeaderPath);
    } catch (err) {
      console.error(
        "⚠️ No se pudo imprimir el logo de encabezado:",
        err.message
      );
    }
  }

  printer.newLine();

  // LISTA DE PRODUCTOS
  if (pedido.detallePedido && pedido.detallePedido.length > 0) {
    if (useFontTicket) {
      for (const item of pedido.detallePedido) {
        let nombre = item.name || item.nombre || "Producto sin nombre";
        const cantidad = item.quantity || item.cantidad || 1;
        const precio = item.price || item.precio || 0;

        // Capitalizar: Primera letra mayúscula, resto minúscula
        const nombreFormateado =
          nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

        const textoProducto = `${cantidad}x ${nombreFormateado}: ${formatCurrency(
          precio * cantidad
        )}`;

        try {
          printer.alignCenter();
          printer.bold(true);

          const imagenProducto = await textRenderer.renderizarTexto(
            config.clienteId,
            textoProducto,
            { fontSize: 28, centerText: true }
          );

          await imprimirImagenTexto(printer, imagenProducto);

          if (item.aclaraciones) {
            const imagenAclaracion = await textRenderer.renderizarTexto(
              config.clienteId,
              `   ${item.aclaraciones}`,
              { fontSize: 28, centerText: false }
            );
            await imprimirImagenTexto(printer, imagenAclaracion);
          }
        } catch (err) {
          console.error(`❌ Error al imprimir producto:`, err.message);
          printer.alignCenter();
          printer.bold(true);
          printer.println(
            `${cantidad}x ${nombreFormateado}: ${formatCurrency(
              precio * cantidad
            )}`
          );
          if (item.aclaraciones) {
            printer.println(`   ${item.aclaraciones}`);
          }
        }
      }
    } else {
      for (const item of pedido.detallePedido) {
        let nombre = item.name || item.nombre || "Producto sin nombre";
        const cantidad = item.quantity || item.cantidad || 1;
        const precio = item.price || item.precio || 0;

        const nombreFormateado =
          nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

        printer.alignCenter();
        printer.bold(true);
        printer.println(
          `${cantidad}x ${nombreFormateado}: ${formatCurrency(
            precio * cantidad
          )}`
        );
        printer.bold(false);

        if (item.aclaraciones) {
          printer.println(`   ${item.aclaraciones}`);
        }
      }
    }
    printer.newLine();
  }

  // SUBTOTAL y ENVÍO
  printer.alignRight();

  if (pedido.subTotal && pedido.subTotal !== pedido.total) {
    if (useFontTicket) {
      try {
        const imagenSubtotal = await textRenderer.renderizarTexto(
          config.clienteId,
          `SUBTOTAL: $${pedido.subTotal.toFixed(0)}`,
          { fontSize: 28, centerText: false }
        );
        await imprimirImagenTexto(printer, imagenSubtotal);
      } catch (err) {
        printer.println(`SUBTOTAL: $${pedido.subTotal.toFixed(0)}`);
      }
    } else {
      printer.println(`SUBTOTAL: $${pedido.subTotal.toFixed(0)}`);
    }
  }

  if (pedido.envio && pedido.envio > 0) {
    if (useFontTicket) {
      try {
        const imagenEnvio = await textRenderer.renderizarTexto(
          config.clienteId,
          `ENVÍO: $${pedido.envio.toFixed(0)}`,
          { fontSize: 28, centerText: false }
        );
        await imprimirImagenTexto(printer, imagenEnvio);
      } catch (err) {
        printer.println(`ENVÍO: $${pedido.envio.toFixed(0)}`);
      }
    } else {
      printer.println(`ENVÍO: $${pedido.envio.toFixed(0)}`);
    }
  }

  // TOTAL + ICONO
  printer.bold(true);
  // printer.newLine();
  printer.alignCenter();

  if (useFontTicket) {
    try {
      const sharp = require("sharp");

      const svgTotalIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black" width="32" height="32">
        <path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
        <path fill-rule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clip-rule="evenodd" />
        <path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" />
      </svg>
      `;

      const svgBuffer = Buffer.from(svgTotalIcon);

      // Crear el ícono como PNG
      const iconBuffer = await sharp(svgBuffer)
        .png()
        .resize({ width: 32, height: 32 })
        .toBuffer();

      // Formatear el monto total
      const montoYMetodo = `${formatCurrency(pedido.total)} en ${
        pedido.metodoPago
      }`;

      const montoTextoBuffer = await textRenderer.renderizarTexto(
        config.clienteId,
        montoYMetodo,
        { fontSize: 28, centerText: false, bold: true }
      );

      // Obtener metadatos de tamaño
      const iconMeta = await sharp(iconBuffer).metadata();
      const textoMeta = await sharp(montoTextoBuffer).metadata();

      const gap = 4; // px de separación

      const totalWidth = iconMeta.width + gap + textoMeta.width;
      const totalHeight = Math.max(iconMeta.height, textoMeta.height);

      // Crear el canvas y componer todo
      const combinedBuffer = await sharp({
        create: {
          width: totalWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      })
        .composite([
          {
            input: iconBuffer,
            top: Math.floor((totalHeight - iconMeta.height) / 2),
            left: 0,
          },
          {
            input: montoTextoBuffer,
            top: Math.floor((totalHeight - textoMeta.height) / 2),
            left: iconMeta.width + gap,
          },
        ])
        .png()
        .toBuffer();

      await imprimirImagenTexto(printer, combinedBuffer);
    } catch (err) {
      console.error("Error generando TOTAL con ícono:", err.message);
      printer.println(
        `TOTAL: ${formatCurrency(pedido.total)} en ${pedido.metodoPago}`
      );
    }
  } else {
    printer.println(`TOTAL: ${formatCurrency(pedido.total)}`);
  }

  // MÉTODO DE PAGO Y CLIENTE
  if (useFontTicket) {
    try {
      const sharp = require("sharp");

      const svgClienteIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black" width="32" height="32">
        <path fill-rule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clip-rule="evenodd" />
      </svg>
      `;

      const svgBuffer = Buffer.from(svgClienteIcon);

      // Crear ícono cliente
      const iconBuffer = await sharp(svgBuffer)
        .png()
        .resize({ width: 32, height: 32 })
        .toBuffer();

      // Crear texto del teléfono
      const telefonoTextoBuffer = await textRenderer.renderizarTexto(
        config.clienteId,
        pedido.telefono,
        { fontSize: 28, centerText: false }
      );

      // Obtener tamaños
      const iconMeta = await sharp(iconBuffer).metadata();
      const textoMeta = await sharp(telefonoTextoBuffer).metadata();

      const gap = 4; // px separación

      const totalWidth = iconMeta.width + gap + textoMeta.width;
      const totalHeight = Math.max(iconMeta.height, textoMeta.height);

      // Combinar ícono + teléfono
      const combinedBuffer = await sharp({
        create: {
          width: totalWidth,
          height: totalHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      })
        .composite([
          {
            input: iconBuffer,
            top: Math.floor((totalHeight - iconMeta.height) / 2),
            left: 0,
          },
          {
            input: telefonoTextoBuffer,
            top: Math.floor((totalHeight - textoMeta.height) / 2),
            left: iconMeta.width + gap,
          },
        ])
        .png()
        .toBuffer();

      await imprimirImagenTexto(printer, combinedBuffer);
    } catch (err) {
      console.error("Error generando teléfono con ícono:", err.message);
      printer.println(`${pedido.telefono}`);
    }
  } else {
    printer.println(
      `$${pedido.total.toFixed(0)} en ${pedido.metodoPago} para el cliente: ${
        pedido.telefono
      }`
    );
  }

  // DIRECCIÓN PARA DELIVERY
  if (pedido.direccion) {
    printer.newLine();
    printer.drawLine();

    if (useFontTicket) {
      try {
        const imagenDireccionTitulo = await textRenderer.renderizarTexto(
          config.clienteId,
          "DIRECCIÓN:",
          { fontSize: 28, centerText: false, bold: true }
        );
        await imprimirImagenTexto(printer, imagenDireccionTitulo);

        const imagenDireccion = await textRenderer.renderizarTexto(
          config.clienteId,
          pedido.direccion,
          { fontSize: 28, centerText: false }
        );
        await imprimirImagenTexto(printer, imagenDireccion);
      } catch (err) {
        printer.println("DIRECCIÓN:");
        printer.println(pedido.direccion);
      }
    } else {
      printer.println("DIRECCIÓN:");
      printer.println(pedido.direccion);
    }

    if (pedido.aclaraciones) {
      if (useFontTicket) {
        try {
          const imagenRefTitulo = await textRenderer.renderizarTexto(
            config.clienteId,
            "REFERENCIA:",
            { fontSize: 28, centerText: false, bold: true }
          );
          await imprimirImagenTexto(printer, imagenRefTitulo);

          const imagenRef = await textRenderer.renderizarTexto(
            config.clienteId,
            pedido.aclaraciones,
            { fontSize: 28, centerText: false }
          );
          await imprimirImagenTexto(printer, imagenRef);
        } catch (err) {
          printer.println("REFERENCIA:");
          printer.println(pedido.aclaraciones);
        }
      } else {
        printer.println("REFERENCIA:");
        printer.println(pedido.aclaraciones);
      }
    }
  }

  // PIE DE TICKET
  printer.newLine();
  printer.alignCenter();

  if (config.useFooterLogo && fs.existsSync(logoFooterPath)) {
    try {
      const tempLogoPath = path.join(__dirname, "..", "temp-footer-logo.png");

      await sharp(logoFooterPath).resize({ width: 100 }).toFile(tempLogoPath);

      await printer.printImage(tempLogoPath);

      fs.unlinkSync(tempLogoPath);
    } catch (err) {
      console.error("⚠️ No se pudo imprimir el logo de pie:", err.message);
    }
  }

  if (useFontTicket) {
    try {
      const imagenEmpresa = await textRenderer.renderizarTexto(
        config.clienteId,
        "Absolute Soluciones Empresariales",
        { fontSize: 28, centerText: true, bold: true }
      );
      await imprimirImagenTexto(printer, imagenEmpresa);

      const imagenWeb = await textRenderer.renderizarTexto(
        config.clienteId,
        "CONABSOLUTE.COM",
        { fontSize: 28, centerText: true }
      );
      await imprimirImagenTexto(printer, imagenWeb);
    } catch (err) {
      printer.bold(true);
      printer.println("Absolute Soluciones Empresariales");
      printer.println("CONABSOLUTE.COM");
    }
  } else {
    printer.bold(true);
    printer.println("Absolute Soluciones Empresariales");
    printer.println("CONABSOLUTE.COM");
  }

  printer.cut();
  await printer.execute();
}

/**
 * Imprime una etiqueta de precio para góndola
 */
async function imprimirEtiquetaPrecio(printer, data, config, useFontTicket) {
  // ENCABEZADO DEL TICKET
  printer.alignCenter();
  if (config.useHeaderLogo && fs.existsSync(logoHeaderPath)) {
    try {
      console.log("📷 Imprimiendo logo de encabezado...");
      // Crear una versión redimensionada del logo del encabezado
      const sharp = require("sharp");
      const tempHeaderLogoPath = path.join(
        __dirname,
        "..",
        "temp-header-logo.png"
      );

      // Redimensionar a un ancho que sea el doble del footer (200px)
      await sharp(logoHeaderPath)
        .resize({ width: 400 }) // El doble del tamaño del footer (100px)
        .toFile(tempHeaderLogoPath);

      // Imprimir la versión redimensionada
      await printer.printImage(tempHeaderLogoPath);

      // Eliminar el archivo temporal
      fs.unlinkSync(tempHeaderLogoPath);
    } catch (err) {
      console.error(
        "⚠️ No se pudo imprimir el logo de encabezado:",
        err.message
      );
    }
  }

  printer.newLine();

  printer.alignCenter();

  // Textos de promo
  if (useFontTicket) {
    try {
      const imagenEmpresa = await textRenderer.renderizarTexto(
        config.clienteId,
        "2x1",
        { fontSize: 320, centerText: true, bold: true }
      );
      await imprimirImagenTexto(printer, imagenEmpresa);
    } catch (err) {
      printer.bold(true);
      printer.println("PROMO");
    }
  } else {
    printer.bold(true);
    printer.println("PROMO");
  }

  // printer.newLine();
  // printer.newLine();
  // printer.newLine();
  // Añadir línea continua centrada de un tercio del ancho
  printer.alignCenter();
  const fullWidth = printer.getWidth() || 30; // Ancho predeterminado si no está disponible
  const lineWidth = Math.floor(fullWidth / 3); // Un tercio del ancho
  const continuousLine = "_".repeat(lineWidth);
  printer.println(continuousLine);
  printer.newLine();
  printer.newLine();
  printer.newLine();
  printer.alignCenter();

  // Nombre del producto
  let nombreProducto = data.productName || "Producto sin nombre";
  const nombreFormateado =
    nombreProducto.charAt(0).toUpperCase() +
    nombreProducto.slice(1).toLowerCase();

  if (useFontTicket) {
    try {
      const imgProduct = await textRenderer.renderizarTexto(
        config.clienteId,
        nombreFormateado,
        { fontSize: 40, centerText: true, bold: true }
      );
      await imprimirImagenTexto(printer, imgProduct);
    } catch (err) {
      printer.bold(true);
      printer.println(nombreFormateado);
      printer.bold(false);
    }
  } else {
    printer.bold(true);
    printer.println(nombreFormateado);
    printer.bold(false);
  }

  printer.newLine();

  // Precio (en grande)
  if (useFontTicket) {
    try {
      const imgPrice = await textRenderer.renderizarTexto(
        config.clienteId,
        formatCurrency(data.price),
        { fontSize: 160, centerText: true, bold: true }
      );
      await imprimirImagenTexto(printer, imgPrice);
    } catch (err) {
      printer.bold(true);
      printer.setTextSize(2, 2);
      printer.println(formatCurrency(data.price));
      printer.setTextSize(1, 1);
      printer.bold(false);
    }
  } else {
    printer.bold(true);
    printer.setTextSize(2, 2);
    printer.println(formatCurrency(data.price));
    printer.setTextSize(1, 1);
    printer.bold(false);
  }

  // PIE DE TICKET
  printer.newLine();
  printer.alignCenter();

  // Imprimir logo inferior si existe y está habilitado
  if (config.useFooterLogo && fs.existsSync(logoFooterPath)) {
    try {
      // Crear una versión redimensionada del logo
      const sharp = require("sharp");
      const tempLogoPath = path.join(__dirname, "..", "temp-footer-logo.png");

      // Redimensionar a un ancho específico (por ejemplo, 200px de ancho)
      await sharp(logoFooterPath)
        .resize({ width: 100 }) // Cambia este valor para ajustar el tamaño
        .toFile(tempLogoPath);

      // Imprimir la versión redimensionada
      await printer.printImage(tempLogoPath);

      // Eliminar el archivo temporal
      fs.unlinkSync(tempLogoPath);
    } catch (err) {
      console.error("⚠️ No se pudo imprimir el logo de pie:", err.message);
    }
  }

  // Textos de pie
  if (useFontTicket) {
    try {
      const imagenEmpresa = await textRenderer.renderizarTexto(
        config.clienteId,
        "Absolute Soluciones Empresariales",
        { fontSize: 28, centerText: true, bold: true }
      );
      await imprimirImagenTexto(printer, imagenEmpresa);

      const imagenWeb = await textRenderer.renderizarTexto(
        config.clienteId,
        "CONABSOLUTE.COM",
        { fontSize: 28, centerText: true }
      );
      await imprimirImagenTexto(printer, imagenWeb);
    } catch (err) {
      printer.bold(true);
      printer.println("Absolute Soluciones Empresariales");
      printer.println("CONABSOLUTE.COM");
    }
  } else {
    printer.bold(true);
    printer.println("Absolute Soluciones Empresariales");
    printer.println("CONABSOLUTE.COM");
  }

  printer.cut();
  await printer.execute();
}

module.exports = {
  imprimirConPlantilla,
};
