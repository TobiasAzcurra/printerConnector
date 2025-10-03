// src/printer-renderer.js
const fs = require("fs");
const path = require("path");
const {
  printer: ThermalPrinter,
  types: PrinterTypes,
} = require("node-thermal-printer");
const fontRenderer = require("./font-renderer");
const textRenderer = require("./font-renderer/text-renderer");
const templateSystem = require("./templates");
const { printHeaderLogo, printFooterLogo } = require("./print-logos");

// Ruta para guardar imágenes temporales
const tempFontImagePath = path.join(__dirname, "..", "temp-font-image.png");

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
    const tempPath = `${tempFontImagePath.replace(
      ".png",
      ""
    )}-${Date.now()}.png`;
    fs.writeFileSync(tempPath, imageBuffer);
    await printer.printImage(tempPath);
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

    const printer = await inicializarImpresora(config);
    if (!printer) return false;

    const useFontTicket = config.useFontTicket === true;

    if (useFontTicket) {
      try {
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
  // ENCABEZADO DEL TICKET (logo cliente si está habilitado)
  await printHeaderLogo(printer, config);
  printer.newLine();

  // LISTA DE PRODUCTOS
  if (pedido.detallePedido && pedido.detallePedido.length > 0) {
    if (useFontTicket) {
      for (const item of pedido.detallePedido) {
        let nombre = item.name || item.nombre || "Producto sin nombre";
        const cantidad = item.quantity || item.cantidad || 1;
        const precio = item.price || item.precio || 0;

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

  // SUBTOTAL, ENVÍO Y DESCUENTOS
  // printer.alignRight();

  // if (pedido.subTotal && pedido.subTotal !== pedido.total) {
  //   if (useFontTicket) {
  //     try {
  //       const imagenSubtotal = await textRenderer.renderizarTexto(
  //         config.clienteId,
  //         `SUBTOTAL: ${formatCurrency(pedido.subTotal)}`,
  //         { fontSize: 28, centerText: false }
  //       );
  //       await imprimirImagenTexto(printer, imagenSubtotal);
  //     } catch (err) {
  //       printer.println(`SUBTOTAL: ${formatCurrency(pedido.subTotal)}`);
  //     }
  //   } else {
  //     printer.println(`SUBTOTAL: ${formatCurrency(pedido.subTotal)}`);
  //   }
  // }

  // if (pedido.descuentos && pedido.descuentos > 0) {
  //   if (useFontTicket) {
  //     try {
  //       const imagenDescuento = await textRenderer.renderizarTexto(
  //         config.clienteId,
  //         `DESCUENTOS: -${formatCurrency(pedido.descuentos)}`,
  //         { fontSize: 28, centerText: false }
  //       );
  //       await imprimirImagenTexto(printer, imagenDescuento);
  //     } catch (err) {
  //       printer.println(`DESCUENTOS: -${formatCurrency(pedido.descuentos)}`);
  //     }
  //   } else {
  //     printer.println(`DESCUENTOS: -${formatCurrency(pedido.descuentos)}`);
  //   }
  // }

  // if (pedido.envio && pedido.envio > 0) {
  //   if (useFontTicket) {
  //     try {
  //       const imagenEnvio = await textRenderer.renderizarTexto(
  //         config.clienteId,
  //         `ENVÍO: ${formatCurrency(pedido.envio)}`,
  //         { fontSize: 28, centerText: false }
  //       );
  //       await imprimirImagenTexto(printer, imagenEnvio);
  //     } catch (err) {
  //       printer.println(`ENVÍO: ${formatCurrency(pedido.envio)}`);
  //     }
  //   } else {
  //     printer.println(`ENVÍO: ${formatCurrency(pedido.envio)}`);
  //   }
  // }

  // TOTAL + ICONO
  printer.bold(true);
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
      const iconBuffer = await sharp(svgBuffer)
        .png()
        .resize({ width: 32, height: 32 })
        .toBuffer();

      const montoYMetodo = `${formatCurrency(pedido.total)} en ${
        pedido.metodoPago
      }`;

      const montoTextoBuffer = await textRenderer.renderizarTexto(
        config.clienteId,
        montoYMetodo,
        { fontSize: 28, centerText: false, bold: true }
      );

      const iconMeta = await sharp(iconBuffer).metadata();
      const textoMeta = await sharp(montoTextoBuffer).metadata();

      const gap = 4;
      const totalWidth = iconMeta.width + gap + textoMeta.width;
      const totalHeight = Math.max(iconMeta.height, textoMeta.height);

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
      const iconBuffer = await sharp(svgBuffer)
        .png()
        .resize({ width: 32, height: 32 })
        .toBuffer();

      const telefonoTextoBuffer = await textRenderer.renderizarTexto(
        config.clienteId,
        pedido.telefono,
        { fontSize: 28, centerText: false }
      );

      const iconMeta = await sharp(iconBuffer).metadata();
      const textoMeta = await sharp(telefonoTextoBuffer).metadata();

      const gap = 4;
      const totalWidth = iconMeta.width + gap + textoMeta.width;
      const totalHeight = Math.max(iconMeta.height, textoMeta.height);

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
      `${formatCurrency(pedido.total)} en ${
        pedido.metodoPago
      } para el cliente: ${pedido.telefono}`
    );
  }

  // DIRECCIÓN / TIPO DE ENTREGA
  if (pedido.direccion && pedido.direccion.trim()) {
    if (useFontTicket) {
      try {
        const sharp = require("sharp");

        // Icono de ubicación/mapa
        const svgEntregaIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black" width="32" height="32">
        <path fill-rule="evenodd" d="m11.54 22.351.07.04.028.016a.76.76 0 0 0 .723 0l.028-.015.071-.041a16.975 16.975 0 0 0 1.144-.742 19.58 19.58 0 0 0 2.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 0 0-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 0 0 2.682 2.282 16.975 16.975 0 0 0 1.145.742ZM12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
      </svg>
      `;

        const svgBuffer = Buffer.from(svgEntregaIcon);
        const iconBuffer = await sharp(svgBuffer)
          .png()
          .resize({ width: 32, height: 32 })
          .toBuffer();

        const direccionTextoBuffer = await textRenderer.renderizarTexto(
          config.clienteId,
          pedido.direccion,
          { fontSize: 28, centerText: false }
        );

        const iconMeta = await sharp(iconBuffer).metadata();
        const textoMeta = await sharp(direccionTextoBuffer).metadata();

        const gap = 4;
        const totalWidth = iconMeta.width + gap + textoMeta.width;
        const totalHeight = Math.max(iconMeta.height, textoMeta.height);

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
              input: direccionTextoBuffer,
              top: Math.floor((totalHeight - textoMeta.height) / 2),
              left: iconMeta.width + gap,
            },
          ])
          .png()
          .toBuffer();

        printer.alignCenter();
        await imprimirImagenTexto(printer, combinedBuffer);
      } catch (err) {
        console.error("Error generando dirección con ícono:", err.message);
        printer.alignCenter();
        printer.println(pedido.direccion);
      }
    } else {
      printer.alignCenter();
      printer.println(pedido.direccion);
    }

    // NOTAS DE DELIVERY
    if (pedido.deliveryNotes && pedido.deliveryNotes.trim()) {
      if (useFontTicket) {
        try {
          const sharp = require("sharp");

          // Icono de nota/documento
          const svgNotasIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black" width="32" height="32">
          <path fill-rule="evenodd" d="M4.125 3C3.089 3 2.25 3.84 2.25 4.875V18a3 3 0 0 0 3 3h15a3 3 0 0 1-3-3V4.875C17.25 3.839 16.41 3 15.375 3H4.125ZM12 9.75a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5H12Zm-.75-2.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5H12a.75.75 0 0 1-.75-.75ZM6 12.75a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5H6Zm-.75 3.75a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1-.75-.75ZM6 6.75a.75.75 0 0 0-.75.75v3c0 .414.336.75.75.75h3a.75.75 0 0 0 .75-.75v-3A.75.75 0 0 0 9 6.75H6Z" clip-rule="evenodd" />
          <path d="M18.75 6.75h1.875c.621 0 1.125.504 1.125 1.125V18a1.5 1.5 0 0 1-3 0V6.75Z" />
        </svg>
        `;

          const svgBuffer = Buffer.from(svgNotasIcon);
          const iconBuffer = await sharp(svgBuffer)
            .png()
            .resize({ width: 32, height: 32 })
            .toBuffer();

          const notasTextoBuffer = await textRenderer.renderizarTexto(
            config.clienteId,
            pedido.deliveryNotes,
            { fontSize: 28, centerText: false }
          );

          const iconMeta = await sharp(iconBuffer).metadata();
          const textoMeta = await sharp(notasTextoBuffer).metadata();

          const gap = 4;
          const totalWidth = iconMeta.width + gap + textoMeta.width;
          const totalHeight = Math.max(iconMeta.height, textoMeta.height);

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
                input: notasTextoBuffer,
                top: Math.floor((totalHeight - textoMeta.height) / 2),
                left: iconMeta.width + gap,
              },
            ])
            .png()
            .toBuffer();

          printer.alignCenter();
          await imprimirImagenTexto(printer, combinedBuffer);
        } catch (err) {
          console.error(
            "Error generando notas de delivery con ícono:",
            err.message
          );
          printer.alignCenter();
          printer.println(pedido.deliveryNotes);
        }
      } else {
        printer.alignCenter();
        printer.println(pedido.deliveryNotes);
      }
    }
  }

  // NOTAS DEL PEDIDO (orderNotes) - SIEMPRE SE MUESTRA SI EXISTEN
  if (pedido.aclaraciones && pedido.aclaraciones.trim()) {
    if (useFontTicket) {
      try {
        const sharp = require("sharp");

        // Icono de mensaje/chat
        const svgAclaracionesIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black" width="32" height="32">
        <path fill-rule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97Z" clip-rule="evenodd" />
      </svg>
      `;

        const svgBuffer = Buffer.from(svgAclaracionesIcon);
        const iconBuffer = await sharp(svgBuffer)
          .png()
          .resize({ width: 32, height: 32 })
          .toBuffer();

        const aclaracionesTextoBuffer = await textRenderer.renderizarTexto(
          config.clienteId,
          pedido.aclaraciones,
          { fontSize: 28, centerText: false }
        );

        const iconMeta = await sharp(iconBuffer).metadata();
        const textoMeta = await sharp(aclaracionesTextoBuffer).metadata();

        const gap = 4;
        const totalWidth = iconMeta.width + gap + textoMeta.width;
        const totalHeight = Math.max(iconMeta.height, textoMeta.height);

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
              input: aclaracionesTextoBuffer,
              top: Math.floor((totalHeight - textoMeta.height) / 2),
              left: iconMeta.width + gap,
            },
          ])
          .png()
          .toBuffer();

        printer.alignCenter();
        await imprimirImagenTexto(printer, combinedBuffer);
      } catch (err) {
        console.error("Error generando aclaraciones con ícono:", err.message);
        printer.alignCenter();
        printer.println(pedido.aclaraciones);
      }
    } else {
      printer.alignCenter();
      printer.println(pedido.aclaraciones);
    }
  }

  // PIE DE TICKET (logo cliente si está habilitado)
  printer.newLine();
  printer.alignCenter();

  await printFooterLogo(printer, config);

  printer.newLine();

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

/**
 * Imprime una etiqueta de precio para góndola
 */
async function imprimirEtiquetaPrecio(printer, data, config, useFontTicket) {
  printer.alignCenter();
  await printHeaderLogo(printer, config);
  printer.newLine();

  if (data.header) {
    printer.alignCenter();

    if (useFontTicket) {
      try {
        const imagenEmpresa = await textRenderer.renderizarTexto(
          config.clienteId,
          data.header,
          { fontSize: 260, centerText: true, bold: true }
        );
        await imprimirImagenTexto(printer, imagenEmpresa);
      } catch (err) {
        printer.bold(true);
        printer.println(data.header || "PROMO");
      }
    } else {
      printer.bold(true);
      printer.println(data.header || "PROMO");
    }

    printer.newLine();
    printer.newLine();
    printer.newLine();
    printer.alignCenter();
    const fullWidth = printer.getWidth() || 30;
    const lineWidth = Math.floor(fullWidth / 3);
    const continuousLine = "_".repeat(lineWidth);
    printer.println(continuousLine);
    printer.newLine();
    printer.newLine();
    printer.newLine();
    printer.alignCenter();
  }

  let nombreProducto = data.productName || "Producto sin nombre";
  const nombreFormateado =
    nombreProducto.charAt(0).toUpperCase() +
    nombreProducto.slice(1).toLowerCase();

  if (useFontTicket) {
    try {
      const caracteresMaxPorLinea = Math.floor(260 / 5);

      if (nombreFormateado.length > caracteresMaxPorLinea) {
        const mitad = Math.floor(nombreFormateado.length / 2);
        let puntoCorte = nombreFormateado.lastIndexOf(" ", mitad);
        if (puntoCorte === -1)
          puntoCorte = nombreFormateado.indexOf(" ", mitad);
        if (puntoCorte === -1) puntoCorte = mitad;

        const primeraLinea = nombreFormateado.substring(0, puntoCorte);
        const segundaLinea = nombreFormateado.substring(
          puntoCorte + (nombreFormateado[puntoCorte] === " " ? 1 : 0)
        );

        const imgProductLine1 = await textRenderer.renderizarTexto(
          config.clienteId,
          primeraLinea,
          { fontSize: 28, centerText: true, bold: true }
        );
        await imprimirImagenTexto(printer, imgProductLine1);

        const imgProductLine2 = await textRenderer.renderizarTexto(
          config.clienteId,
          segundaLinea,
          { fontSize: 28, centerText: true, bold: true }
        );
        await imprimirImagenTexto(printer, imgProductLine2);
      } else {
        const imgProduct = await textRenderer.renderizarTexto(
          config.clienteId,
          nombreFormateado,
          { fontSize: 28, centerText: true, bold: true }
        );
        await imprimirImagenTexto(printer, imgProduct);
      }
    } catch (err) {
      printer.bold(true);
      printer.println(nombreFormateado);
      printer.bold(false);
    }
  } else {
    printer.bold(true);

    const caracteresMaxPorLinea = printer.getWidth() || 32;
    if (nombreFormateado.length > caracteresMaxPorLinea) {
      const palabras = nombreFormateado.split(" ");
      let lineaActual = "";
      for (const palabra of palabras) {
        if (lineaActual.length + 1 + palabra.length > caracteresMaxPorLinea) {
          printer.println(lineaActual);
          lineaActual = palabra;
        } else {
          lineaActual = lineaActual ? `${lineaActual} ${palabra}` : palabra;
        }
      }
      if (lineaActual) printer.println(lineaActual);
    } else {
      printer.println(nombreFormateado);
    }
    printer.bold(false);
  }

  printer.newLine();

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

  printer.newLine();
  printer.alignCenter();

  await printFooterLogo(printer, config);

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
