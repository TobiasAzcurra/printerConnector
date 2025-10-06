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
const queueDir = path.join(ROOT_DIR, "print-queue");
const processingDir = path.join(ROOT_DIR, "print-processing");

let config = {};
let socket = null;
let isProcessingQueue = false; // Flag para evitar procesamiento concurrente

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
      console.log("✅ Impresora encontrada en la red");
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

  try {
    await printHeaderLogo(printer, config);
  } catch (e) {
    console.warn("⚠️ No se pudo imprimir header logo:", e.message);
  }

  printer.newLine();
  printer.newLine();

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

  try {
    await printFooterLogo(printer, config);
  } catch (e) {
    console.warn("⚠️ No se pudo imprimir footer logo:", e.message);
  }

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
// 👉 Ahora acepta una opción 'coldStart' y NO imprime confirmación por defecto
async function reiniciarConector({ coldStart = false } = {}) {
  console.log("🔁 Recargando configuración...");
  cargarConfig();
  diagnosticarRed(config.printerIP);
  conectarBackend();

  // Ya no imprimimos confirmación acá.
  // Solo gestionamos trabajos pendientes y seguimos.
  checkPendingPrintJobs();

  return { coldStart };
}

/* ==========================
   Handler de impresión
   ========================== */
async function handleImpresion(datos) {
  const jobId = datos._templateInfo?.jobId || "Sin ID";
  console.log("📥 Trabajo de impresión recibido:", jobId);

  const templateId = datos._templateInfo?.id || "receipt";
  console.log(`🖨️ Usando plantilla: ${templateId}`);

  try {
    const ok = await printerRenderer.imprimirConPlantilla(
      config,
      datos,
      templateId
    );
    if (ok) {
      console.log(`✅ Impresión completada exitosamente: ${jobId}`);
    } else {
      console.error(`❌ Error durante la impresión: ${jobId}`);
    }
  } catch (err) {
    console.error(`❌ Error al imprimir ${jobId}:`, err);
  }
}

/* ==========================
   Trabajos pendientes
   ========================== */
function checkPendingPrintJobs() {
  if (fs.existsSync(tempPrintJobPath)) {
    try {
      console.log("🔄 Migrando trabajo antiguo a nueva cola...");
      const jobContent = fs.readFileSync(tempPrintJobPath, "utf8");
      const datos = JSON.parse(jobContent);

      if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
      }

      if (datos.isBatchPrint && Array.isArray(datos.jobs)) {
        datos.jobs.forEach((job, index) => {
          const jobId = `${Date.now()}-migrated-${index}`;
          const jobPath = path.join(queueDir, `${jobId}.json`);
          fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
        });
      } else {
        const jobId = `${Date.now()}-migrated`;
        const jobPath = path.join(queueDir, `${jobId}.json`);
        fs.writeFileSync(jobPath, JSON.stringify(datos, null, 2));
      }

      fs.unlinkSync(tempPrintJobPath);
      console.log("✅ Trabajo antiguo migrado a cola");
    } catch (err) {
      console.error("❌ Error al migrar trabajo antiguo:", err);
      try {
        fs.unlinkSync(tempPrintJobPath);
      } catch (e) {
        console.error("No se pudo eliminar el archivo temporal:", e);
      }
    }
  }

  processPrintQueue();
}

/* ==========================
   Procesador de cola
   ========================== */
async function processPrintQueue() {
  if (isProcessingQueue) {
    console.log("⏭️ Ya hay un proceso de cola en ejecución, saltando...");
    return;
  }

  try {
    isProcessingQueue = true;

    if (!fs.existsSync(queueDir)) {
      isProcessingQueue = false;
      return;
    }

    const files = fs
      .readdirSync(queueDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    if (files.length === 0) {
      isProcessingQueue = false;
      return;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📋 COLA DE IMPRESIÓN: ${files.length} trabajos pendientes`);
    console.log(`${"=".repeat(60)}\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const jobPath = path.join(queueDir, file);
      const processingPath = path.join(processingDir, file);

      console.log(`\n[${i + 1}/${files.length}] Procesando: ${file}`);

      try {
        if (!fs.existsSync(processingDir)) {
          fs.mkdirSync(processingDir, { recursive: true });
        }

        console.log(`  📁 Moviendo a processing: ${file}`);
        fs.renameSync(jobPath, processingPath);

        const jobContent = fs.readFileSync(processingPath, "utf8");
        const datos = JSON.parse(jobContent);

        const jobId = datos._templateInfo?.jobId || file;
        console.log(`  🖨️ Imprimiendo job: ${jobId}`);

        const startTime = Date.now();
        await handleImpresion(datos);
        const duration = Date.now() - startTime;

        console.log(`  ✅ Completado en ${duration}ms`);
        console.log(`  🗑️ Eliminando archivo procesado`);
        fs.unlinkSync(processingPath);

        console.log(`  ⏳ Esperando 500ms antes del siguiente...`);
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`  ❌ Error procesando ${file}:`, err.message);

        if (fs.existsSync(processingPath)) {
          try {
            console.log(`  ↩️ Devolviendo ${file} a la cola para reintentar`);
            fs.renameSync(processingPath, jobPath);
          } catch (e) {
            console.error(`  ⚠️ No se pudo devolver a cola:`, e.message);
          }
        }
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ PROCESAMIENTO COMPLETADO`);
    console.log(`${"=".repeat(60)}\n`);
  } catch (err) {
    console.error("❌ Error general en procesamiento de cola:", err);
  } finally {
    isProcessingQueue = false;
  }
}

/* ==========================
   Watcher de config
   ========================== */
// 👉 Al cambiar config.json, solo recargamos. NO imprimimos confirmación.
fs.watchFile(configPath, () => {
  console.log("📄 config.json modificado. Recargando...");
  reiniciarConector({ coldStart: false });
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
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
    console.log("📁 Carpeta de cola de impresión creada");
  }
  if (!fs.existsSync(processingDir)) {
    fs.mkdirSync(processingDir, { recursive: true });
    console.log("📁 Carpeta de procesamiento creada");
  }

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
   Polling de cola cada 2 segundos
   ========================== */
setInterval(() => {
  processPrintQueue();
}, 2000);

/* ==========================
   Run
   ========================== */
crearEstructuraDirectorios();

// Arranque en frío: recargamos y LUEGO imprimimos confirmación SOLO una vez
reiniciarConector({ coldStart: true }).then(async () => {
  const hayTrabajosPendientes =
    fs.existsSync(tempPrintJobPath) ||
    (fs.existsSync(queueDir) &&
      fs.readdirSync(queueDir).filter((f) => f.endsWith(".json")).length > 0);

  if (!hayTrabajosPendientes) {
    await imprimirConfirmacion();
  }
});
