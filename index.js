const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const io = require("socket.io-client");
const {
  printer: ThermalPrinter,
  types: PrinterTypes,
} = require("node-thermal-printer");
const fontRenderer = require("./src/font-renderer");
const fontCache = require("./src/font-renderer/cache");
const textRenderer = require("./src/font-renderer/text-renderer");
const templateSystem = require("./src/templates");
const printerRenderer = require("./src/printer-renderer");

const configPath = path.join(__dirname, "config.json");
const tempPrintJobPath = path.join(__dirname, "temp-print-job.json");
const logoHeaderPath = path.join(__dirname, "assets", "logo-header.png"); // Logo superior
const logoFooterPath = path.join(__dirname, "assets", "logo-footer.png"); // Logo inferior
const tempFontImagePath = path.join(__dirname, "temp-font-image.png"); // Ruta para guardar imágenes temporales
let config = {};
let socket = null;

// Función auxiliar para guardar buffer de imagen en archivo temporal e imprimirlo
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

// 🔄 Cargar configuración desde archivo
function cargarConfig() {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          clienteId: "cliente-default",
          printerIP: "",
          printerPort: 9100,
          useHeaderLogo: true, // Usar logo superior
          useFooterLogo: true, // Usar logo inferior
          useFontTicket: false, // Usar fuente personalizada
          ticketWidth: 48, // Ancho del ticket en caracteres
        },
        null,
        2
      )
    );
    console.log(
      "⚠️ No se encontró config.json. Se creó uno por defecto. Editalo desde el navegador."
    );
    process.exit(0);
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(raw);

    // Asegurar que los campos nuevos existan (para retrocompatibilidad)
    if (config.useHeaderLogo === undefined) config.useHeaderLogo = true;
    if (config.useFooterLogo === undefined) config.useFooterLogo = true;
    if (config.useFontTicket === undefined) config.useFontTicket = false;
    if (config.ticketWidth === undefined) config.ticketWidth = 48;

    // Retrocompatibilidad con configuración anterior
    if (config.useLogo !== undefined && config.useHeaderLogo === undefined) {
      config.useHeaderLogo = config.useLogo;
    }

    console.log("✅ Config cargada:", config);
  } catch (err) {
    console.error("❌ Error al leer config.json:", err);
    process.exit(1);
  }
}

// 🧪 Diagnóstico automático de red
function diagnosticarRed(ip) {
  console.log("\n🔍 Ejecutando diagnóstico de conexión con la impresora...\n");

  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    console.log("❌ IP inválida:", ip);
    return;
  }

  exec(`ping -n 2 ${ip}`, (error, stdout, stderr) => {
    if (error) {
      console.log("❌ Error al intentar hacer ping:", error.message);
      return;
    }

    if (stdout.includes("Host de destino inaccesible")) {
      console.log("🚫 La impresora NO está accesible en la red.");
      console.log(
        "📋 Verificá que esté conectada al router y en la misma red que esta computadora."
      );
    } else if (stdout.includes("tiempo de espera agotado")) {
      console.log("⏱️ La impresora no respondió al ping. ¿Está encendida?");
    } else if (stdout.includes("Respuesta desde")) {
      console.log("✅ Impresora encontrada en la red 🎉");
    } else {
      console.log("⚠️ Resultado indeterminado. Revisá conexión e IP.");
    }
  });
}

// 🚀 Conexión al backend
function conectarBackend() {
  if (socket) socket.disconnect();

  socket = io("http://localhost:4000");

  socket.on("connect", () => {
    console.log("🖥️ Conectado al backend como:", config.clienteId);
    socket.emit("register", { clienteId: config.clienteId });
  });

  socket.on("disconnect", () => {
    console.log("❌ Desconectado del backend. Intentando reconectar...");
  });

  socket.on("connect_error", (error) => {
    console.log("❌ Error de conexión con el backend:", error.message);
  });

  socket.on("imprimir", handleImpresion);
}

// 🖨️ Confirmación impresa
async function imprimirConfirmacion() {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${config.printerIP}:${config.printerPort}`,
    width: config.ticketWidth || 48,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    encoding: "utf8", // Añadir codificación explícitamente
  });

  const isConnected = await printer.isPrinterConnected();
  console.log("📡 Verificando conexión con impresora:", isConnected);

  if (!isConnected) {
    console.log("❌ No se pudo imprimir confirmación (impresora no conectada)");
    return;
  }

  // Imprimir logo superior si existe y está habilitado
  if (config.useHeaderLogo && fs.existsSync(logoHeaderPath)) {
    try {
      console.log("📷 Imprimiendo logo de encabezado...");
      await printer.printImage(logoHeaderPath);
      console.log("✅ Logo de encabezado impreso correctamente");
    } catch (err) {
      console.error(
        "⚠️ No se pudo imprimir el logo de encabezado:",
        err.message
      );
    }
  } else {
    if (config.useHeaderLogo) {
      console.log(
        "⚠️ Logo de encabezado habilitado pero no se encontró archivo en:",
        logoHeaderPath
      );
    }
  }

  // Comprobar si se debe usar fuente personalizada para la confirmación
  if (config.useFontTicket) {
    try {
      const fontInfo = fontRenderer.obtenerInfoFuente(config.clienteId);
      if (fontInfo) {
        console.log(
          `🔤 Usando fuente personalizada: ${
            fontInfo.fontFamily || fontInfo.fontName
          }`
        );

        // Generar texto "Impresora conectada correctamente" con fuente personalizada
        const imagen = await textRenderer.renderizarTexto(
          config.clienteId,
          "Impresora conectada correctamente",
          {
            fontSize: 28,
            centerText: true,
            backgroundColor: "#FFFFFF",
          }
        );

        // Imprimir la imagen
        printer.alignCenter();
        await imprimirImagenTexto(printer, imagen);
      } else {
        // Si no hay fuente, usar texto normal
        printer.alignCenter();
        printer.bold(true);
        printer.println("Impresora conectada correctamente");
      }
    } catch (err) {
      // En caso de error, usar texto normal
      console.error("❌ Error con fuente personalizada:", err.message);
      printer.alignCenter();
      printer.bold(true);
      printer.println("Impresora conectada correctamente");
    }
  } else {
    // Usar texto normal si no está habilitada la fuente personalizada
    printer.alignCenter();
    printer.bold(true);
    printer.println("Impresora conectada correctamente");
  }

  // Imprimir logo inferior si existe y está habilitado
  if (config.useFooterLogo && fs.existsSync(logoFooterPath)) {
    try {
      console.log("📷 Imprimiendo logo de pie...");
      printer.alignCenter();
      await printer.printImage(logoFooterPath);
      console.log("✅ Logo de pie impreso correctamente");
    } catch (err) {
      console.error("⚠️ No se pudo imprimir el logo de pie:", err.message);
    }
  } else {
    if (config.useFooterLogo) {
      console.log(
        "⚠️ Logo de pie habilitado pero no se encontró archivo en:",
        logoFooterPath
      );
    }
  }

  if (config.useFontTicket) {
    try {
      const fontInfo = fontRenderer.obtenerInfoFuente(config.clienteId);
      if (fontInfo) {
        // Generar texto "Impulsado por Absolute" con fuente personalizada
        const imagenImpulsado = await textRenderer.renderizarTexto(
          config.clienteId,
          "Impulsado por Absolute.",
          { fontSize: 28, centerText: true, bold: true }
        );

        // Imprimir la imagen
        await imprimirImagenTexto(printer, imagenImpulsado);
      } else {
        printer.println("Impulsado por Absolute.");
      }
    } catch (err) {
      console.error("❌ Error con fuente en pie de confirmación:", err.message);
      printer.println("Impulsado por Absolute.");
    }
  } else {
    printer.println("Impulsado por Absolute.");
  }
  printer.cut();

  try {
    console.log("🖨️ Ejecutando impresión de confirmación...");
    await printer.execute();
    console.log("✅ Confirmación impresa.");
  } catch (err) {
    console.error("❌ Error al imprimir confirmación:", err);
  }
}

// Obtener fecha actual formateada
function getCurrentDate() {
  const today = new Date();
  return today.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Obtener hora actual formateada
function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 🔁 Reinicio completo del conector
async function reiniciarConector() {
  console.log("🔁 Recargando configuración...");
  cargarConfig();
  diagnosticarRed(config.printerIP);
  conectarBackend();

  // Revisar si hay trabajos de impresión pendientes
  const hayTrabajosPendientes = fs.existsSync(tempPrintJobPath);

  // Solo imprimir confirmación si NO hay trabajos pendientes
  if (!hayTrabajosPendientes) {
    await imprimirConfirmacion();
  }

  // Procesar trabajos pendientes
  checkPendingPrintJobs();
}

// 🎫 Impresión del pedido recibido
async function handleImpresion(datos) {
  console.log("📥 Trabajo de impresión recibido:", datos.id || "Sin ID");

  // Determinar qué plantilla usar
  const templateId = datos._templateInfo?.id || "receipt";
  console.log(`🖨️ Usando plantilla: ${templateId}`);

  try {
    // Imprimir usando el sistema de plantillas
    const resultado = await printerRenderer.imprimirConPlantilla(
      config,
      datos,
      templateId
    );

    if (resultado) {
      console.log(`✅ Impresión completada: ${templateId}`);
    } else {
      console.error(`❌ Error durante la impresión: ${templateId}`);
    }
  } catch (err) {
    console.error(`❌ Error al imprimir con plantilla ${templateId}:`, err);
  }
}

// 🔍 Verificar si hay trabajos pendientes de impresión
function checkPendingPrintJobs() {
  if (fs.existsSync(tempPrintJobPath)) {
    try {
      console.log("🔍 Encontrado trabajo de impresión pendiente...");
      const jobContent = fs.readFileSync(tempPrintJobPath, "utf8");
      const datos = JSON.parse(jobContent);

      // Procesamos usando el manejador
      handleImpresion(datos);

      // Eliminamos el archivo temporal
      fs.unlinkSync(tempPrintJobPath);
      console.log("✅ Trabajo de impresión pendiente procesado");
    } catch (err) {
      console.error("❌ Error al procesar trabajo pendiente:", err);
      // Si hay error, intentamos eliminar el archivo de todas formas
      try {
        fs.unlinkSync(tempPrintJobPath);
      } catch (e) {
        console.error("No se pudo eliminar el archivo temporal:", e);
      }
    }
  }
}

// 🔍 Verificar si hay trabajos pendientes de impresión
function checkPendingPrintJobs() {
  if (fs.existsSync(tempPrintJobPath)) {
    try {
      console.log("🔍 Encontrado trabajo de impresión pendiente...");
      const jobContent = fs.readFileSync(tempPrintJobPath, "utf8");
      const pedido = JSON.parse(jobContent);

      // Procesamos el pedido
      handleImpresion(pedido);

      // Eliminamos el archivo temporal
      fs.unlinkSync(tempPrintJobPath);
      console.log("✅ Trabajo de impresión pendiente procesado");
    } catch (err) {
      console.error("❌ Error al procesar trabajo pendiente:", err);
      // Si hay error, intentamos eliminar el archivo de todas formas
      try {
        fs.unlinkSync(tempPrintJobPath);
      } catch (e) {
        console.error("No se pudo eliminar el archivo temporal:", e);
      }
    }
  }
}

// 👀 Watcher de cambios en config.json
fs.watchFile(configPath, () => {
  console.log("📄 Config.json modificado. Recargando...");
  reiniciarConector();
});

// Crear carpetas necesarias si no existen
function crearEstructuraDirectorios() {
  const assetsDir = path.join(__dirname, "assets");
  const fontsDir = path.join(assetsDir, "fonts");
  const fontsCacheDir = path.join(fontsDir, "cache");

  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    console.log("📁 Carpeta de assets creada");
  }

  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
    console.log("📁 Carpeta de fuentes creada");
  }

  if (!fs.existsSync(fontsCacheDir)) {
    fs.mkdirSync(fontsCacheDir, { recursive: true });
    console.log("📁 Carpeta de caché de fuentes creada");
  }
}

// ▶️ Iniciar el conector
crearEstructuraDirectorios();
reiniciarConector();
