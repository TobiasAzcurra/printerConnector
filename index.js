// index.js
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
const { printHeaderLogo, printFooterLogo } = require("./src/print-logos");

const ROOT_DIR = __dirname;
const configPath = path.join(ROOT_DIR, "config.json");
const tempPrintJobPath = path.join(ROOT_DIR, "temp-print-job.json");
const tempFontImagePath = path.join(ROOT_DIR, "temp-font-image.png");

let config = {};
let socket = null;

/* ==========================
   Util: imprimir buffer PNG
   ========================== */
async function imprimirImagenTexto(printer, imageBuffer) {
  try {
    const tmp = `${tempFontImagePath.replace(".png", "")}-${Date.now()}.png`;
    fs.writeFileSync(tmp, imageBuffer);
    await printer.printImage(tmp);
    fs.unlinkSync(tmp);
    return true;
  } catch (err) {
    console.error(`Error al imprimir imagen: ${err.message}`);
    return false;
  }
}

/* ==========================
   Cargar configuración
   ========================== */
function cargarConfig() {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          clienteId: "cliente-default",
          printerIP: "",
          printerPort: 9100,
          useHeaderLogo: true,
          useFooterLogo: true,
          useFontTicket: false,
          ticketWidth: 48,
          // estructura para assets versionados
          assets: {},
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

    // Defaults/retrocompat
    if (config.useHeaderLogo === undefined) config.useHeaderLogo = true;
    if (config.useFooterLogo === undefined) config.useFooterLogo = true;
    if (config.useFontTicket === undefined) config.useFontTicket = false;
    if (config.ticketWidth === undefined) config.ticketWidth = 48;
    if (!config.assets) config.assets = {};
    if (config.useLogo !== undefined && config.useHeaderLogo === undefined) {
      config.useHeaderLogo = config.useLogo;
    }

    console.log("✅ Config cargada:", {
      ...config,
      // evitar log de objetos grandes (recortar paths)
      assets: Object.fromEntries(
        Object.entries(config.assets || {}).map(([k, v]) => [
          k,
          { ...v, path: v?.path },
        ])
      ),
    });
  } catch (err) {
    console.error("❌ Error al leer config.json:", err);
    process.exit(1);
  }
}

/* ==========================
   Diagnóstico de red
   ========================== */
function diagnosticarRed(ip) {
  console.log("\n🔍 Ejecutando diagnóstico de conexión con la impresora...\n");
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) {
    console.log("❌ IP inválida:", ip);
    return;
  }

  // Windows (-n), en Linux/Mac cambiar a -c
  exec(`ping -n 2 ${ip}`, (error, stdout) => {
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
    } else if (
      stdout.includes("Respuesta desde") ||
      stdout.includes("bytes=")
    ) {
      console.log("✅ Impresora encontrada en la red 🎉");
    } else {
      console.log("⚠️ Resultado indeterminado. Revisá conexión e IP.");
    }
  });
}

/* ==========================
   Socket backend
   ========================== */
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

/* ==========================
   Impresión de confirmación
   ========================== */
async function imprimirConfirmacion() {
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
    console.log("❌ No se pudo imprimir confirmación (impresora no conectada)");
    return;
  }

  // Logo HEADER (dinámico por cliente, usando /assets/logos/<clienteId>/header.png si existe)
  try {
    await printHeaderLogo(printer, config);
  } catch (e) {
    console.warn("⚠️ No se pudo imprimir header logo:", e.message);
  }

  printer.newLine();
  printer.newLine();

  // Texto central
  if (config.useFontTicket) {
    try {
      const fontInfo = fontRenderer.obtenerInfoFuente(config.clienteId);
      if (fontInfo) {
        const imagen = await textRenderer.renderizarTexto(
          config.clienteId,
          "Impresora conectada correctamente",
          { fontSize: 28, centerText: true, backgroundColor: "#FFFFFF" }
        );
        printer.alignCenter();
        await imprimirImagenTexto(printer, imagen);
      } else {
        printer.alignCenter();
        printer.bold(true);
        printer.println("Impresora conectada correctamente");
      }
    } catch (err) {
      console.error("❌ Error con fuente personalizada:", err.message);
      printer.alignCenter();
      printer.bold(true);
      printer.println("Impresora conectada correctamente");
    }
  } else {
    printer.alignCenter();
    printer.bold(true);
    printer.println("Impresora conectada correctamente");
  }

  printer.newLine();

  // Logo FOOTER (dinámico por cliente)
  try {
    await printFooterLogo(printer, config);
  } catch (e) {
    console.warn("⚠️ No se pudo imprimir footer logo:", e.message);
  }

  // Pie "Impulsado por Absolute"
  if (config.useFontTicket) {
    try {
      const fontInfo = fontRenderer.obtenerInfoFuente(config.clienteId);
      if (fontInfo) {
        const img = await textRenderer.renderizarTexto(
          config.clienteId,
          "Impulsado por Absolute.",
          { fontSize: 28, centerText: true, bold: true }
        );
        await imprimirImagenTexto(printer, img);
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

/* ==========================
   Reinicio del conector
   ========================== */
async function reiniciarConector() {
  console.log("🔁 Recargando configuración...");
  cargarConfig();
  diagnosticarRed(config.printerIP);
  conectarBackend();

  const hayTrabajosPendientes = fs.existsSync(tempPrintJobPath);

  // Solo imprimo confirmación si NO hay jobs pendientes (no ensuciar cola)
  if (!hayTrabajosPendientes) {
    await imprimirConfirmacion();
  }

  checkPendingPrintJobs();
}

/* ==========================
   Handler de impresión
   ========================== */
async function handleImpresion(datos) {
  console.log("📥 Trabajo de impresión recibido:", datos.id || "Sin ID");

  const templateId = datos._templateInfo?.id || "receipt";
  console.log(`🖨️ Usando plantilla: ${templateId}`);

  try {
    const ok = await printerRenderer.imprimirConPlantilla(
      config,
      datos,
      templateId
    );
    if (ok) console.log(`✅ Impresión completada: ${templateId}`);
    else console.error(`❌ Error durante la impresión: ${templateId}`);
  } catch (err) {
    console.error(`❌ Error al imprimir con plantilla ${templateId}:`, err);
  }
}

/* ==========================
   Trabajos pendientes
   ========================== */
function checkPendingPrintJobs() {
  if (!fs.existsSync(tempPrintJobPath)) return;

  try {
    console.log("🔍 Encontrado trabajo de impresión pendiente...");
    const jobContent = fs.readFileSync(tempPrintJobPath, "utf8");
    const datos = JSON.parse(jobContent);

    if (datos.isBatchPrint && Array.isArray(datos.jobs)) {
      console.log(
        `📦 Procesando lote de ${datos.jobs.length} trabajos de impresión`
      );
      processBatchJobs(datos.jobs);
    } else {
      handleImpresion(datos);
    }

    fs.unlinkSync(tempPrintJobPath);
    console.log("✅ Trabajo de impresión pendiente procesado");
  } catch (err) {
    console.error("❌ Error al procesar trabajo pendiente:", err);
    try {
      fs.unlinkSync(tempPrintJobPath);
    } catch (e) {
      console.error("No se pudo eliminar el archivo temporal:", e);
    }
  }
}

async function processBatchJobs(jobs) {
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`🖨️ Procesando trabajo ${i + 1} de ${jobs.length}`);
    try {
      await handleImpresion(job);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`❌ Error en trabajo ${i + 1}:`, err);
    }
  }
  console.log(`✅ Lote de ${jobs.length} trabajos completado`);
}

/* ==========================
   Watcher de config
   ========================== */
fs.watchFile(configPath, () => {
  console.log("📄 config.json modificado. Recargando...");
  reiniciarConector();
});

/* ==========================
   Estructura de directorios
   ========================== */
function crearEstructuraDirectorios() {
  const assetsDir = path.join(ROOT_DIR, "assets");
  const fontsDir = path.join(assetsDir, "fonts");
  const fontsCacheDir = path.join(fontsDir, "cache");
  const logosDir = path.join(assetsDir, "logos");

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
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
    console.log("📁 Carpeta de logos creada");
  }

  // Crear subcarpetas por cliente si ya hay clienteId en config
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const clienteId = (cfg.clienteId || "cliente-default").toString();
      const logosCliente = path.join(logosDir, clienteId);
      const fontsCliente = path.join(fontsDir, clienteId);
      if (!fs.existsSync(logosCliente))
        fs.mkdirSync(logosCliente, { recursive: true });
      if (!fs.existsSync(fontsCliente))
        fs.mkdirSync(fontsCliente, { recursive: true });
    }
  } catch {}
}

/* ==========================
   Run
   ========================== */
crearEstructuraDirectorios();
reiniciarConector();
