// index.js
const fs   = require("fs");
const path = require("path");
const net  = require("net");
const printerRenderer = require("./src/printer-renderer");
const { createLogger } = require("./src/logger");

const logConfig   = createLogger("Config");
const logQueue    = createLogger("Queue");
const logPrinter  = createLogger("Printer");
const logConfirm  = createLogger("Confirm");
const logNotify   = createLogger("Notify");
const logRecovery = createLogger("Recovery");

const ROOT_DIR = __dirname;
const configPath      = path.join(ROOT_DIR, "config.json");
const queueDir        = process.env.TEST_QUEUE_DIR      ?? path.join(ROOT_DIR, "print-queue");
const processingDir   = process.env.TEST_PROCESSING_DIR ?? path.join(ROOT_DIR, "print-processing");
const confirmDir      = path.join(ROOT_DIR, "pending-confirmations");

const API_BASE            = process.env.API_BASE            ?? "http://localhost:4040";
const MAX_RETRIES         = parseInt(process.env.TEST_MAX_RETRIES      ?? "10",   10);
const BASE_RETRY_DELAY_MS = parseInt(process.env.TEST_RETRY_DELAY_MS   ?? "10000", 10);
const MAX_RETRY_DELAY_MS  = parseInt(process.env.TEST_MAX_RETRY_DELAY_MS ?? String(5 * 60 * 1000), 10);

let config = {};



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
          useHeaderLogo: true,
          useFooterLogo: true,
          useFontTicket: false,
          assets: {},
        },
        null,
        2
      )
    );
    logConfig.warn("No se encontró config.json. Se creó uno por defecto. Editalo desde el navegador.");
    process.exit(0);
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(raw);

    if (config.useHeaderLogo === undefined) config.useHeaderLogo = true;
    if (config.useFooterLogo === undefined) config.useFooterLogo = true;
    if (config.useFontTicket === undefined) config.useFontTicket = false;
    if (!config.assets) config.assets = {};


    logConfig.info("Config cargada:", {
      ...config,
      assets: Object.fromEntries(
        Object.entries(config.assets || {}).map(([k, v]) => [
          k,
          { ...v, path: v?.path },
        ])
      ),
    });
  } catch (err) {
    logConfig.error("Error al leer config.json:", err);
    process.exit(1);
  }
}

/* ==========================
   Confirmación directa en Firestore vía Cloud Function
   ========================== */

async function callConfirmPrint({ logId, orderId, status }) {
  const res = await fetch(config.confirmPrintUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      logId,
      enterpriseId: config.enterpriseId,
      sucursalId:   config.sucursalId,
      orderId,
      status,
      apiKey:       config.apiKey,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
}

async function confirmPrintOnFirestore(datos, status) {
  const logId   = datos._templateInfo?.logId;
  const orderId = datos.orderId;

  if (!logId || !orderId) {
    logConfirm.warn("Job sin logId u orderId — omitiendo confirmación");
    return;
  }

  if (!config.confirmPrintUrl || !config.enterpriseId || !config.sucursalId || !config.apiKey) {
    logConfirm.warn("Config incompleta (faltan confirmPrintUrl, enterpriseId, sucursalId o apiKey)");
    return;
  }

  // Escribir a pending-confirmations antes de intentar la llamada.
  // Si la llamada falla, el archivo queda para reintento automático.
  if (!fs.existsSync(confirmDir)) fs.mkdirSync(confirmDir, { recursive: true });
  const pendingPath = path.join(confirmDir, `${logId}.json`);
  fs.writeFileSync(pendingPath, JSON.stringify({ logId, orderId, status, retries: 0, createdAt: Date.now() }));

  try {
    await callConfirmPrint({ logId, orderId, status });
    fs.unlinkSync(pendingPath);
    logConfirm.info(`Firestore confirmado: ${logId} → ${status}`);
  } catch (err) {
    logConfirm.warn(`Falló confirmación, se reintentará en background: ${err.message}`);
  }
}

async function processPendingConfirmations() {
  if (!fs.existsSync(confirmDir)) return;
  if (!config.confirmPrintUrl || !config.enterpriseId || !config.sucursalId || !config.apiKey) return;

  const files = fs.readdirSync(confirmDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return;

  logConfirm.info(`Procesando ${files.length} confirmaciones pendientes...`);

  for (const file of files) {
    const filePath = path.join(confirmDir, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }

    try {
      await callConfirmPrint(data);
      fs.unlinkSync(filePath);
      logConfirm.info(`Confirmación pendiente resuelta: ${data.logId}`);
    } catch (err) {
      data.retries = (data.retries || 0) + 1;
      if (data.retries > 20) {
        logConfirm.error(`Confirmación abandonada tras 20 intentos: ${data.logId}`);
        const abandonedDir = path.join(confirmDir, "abandoned");
        if (!fs.existsSync(abandonedDir)) fs.mkdirSync(abandonedDir, { recursive: true });
        fs.renameSync(filePath, path.join(abandonedDir, file));
      } else {
        fs.writeFileSync(filePath, JSON.stringify(data));
        logConfirm.warn(`Reintento ${data.retries}/20 fallido para ${data.logId}: ${err.message}`);
      }
    }
  }
}

/* ==========================
   Recuperar jobs huérfanos
   ========================== */
function recoverOrphanedJobs() {
  if (!fs.existsSync(processingDir)) return;

  const orphans = fs.readdirSync(processingDir).filter((f) => f.endsWith(".json"));
  if (orphans.length === 0) return;

  logRecovery.warn(`Recuperando ${orphans.length} job(s) huérfano(s) de print-processing/`);

  for (const file of orphans) {
    const from = path.join(processingDir, file);
    const to   = path.join(queueDir, file);
    try {
      fs.renameSync(from, to);
      logRecovery.info(`${file} → print-queue/`);
    } catch (err) {
      logRecovery.error(`No se pudo recuperar ${file}:`, err.message);
    }
  }
}

/* ==========================
   Reinicio del conector
   ========================== */
function reiniciarConector() {
  logConfig.info("Recargando configuración...");
  cargarConfig();
  recoverOrphanedJobs();
  processPendingConfirmations().catch((err) => logConfirm.error("Error en procesamiento de confirmaciones:", err.message));
  processPrintQueue();
}

/* ==========================
   Handler de impresión
   ========================== */
async function handleImpresion(datos) {
  const jobId = datos._templateInfo?.jobId || "Sin ID";
  logPrinter.info(`Job recibido: ${jobId}`);

  const template = datos._template;

  if (!template || !Array.isArray(template.sections)) {
    logPrinter.error(`Job "${jobId}" rechazado: payload sin _template.sections`);
    return false;
  }

  logPrinter.debug(`Template: ${datos._templateInfo?.id || "sin id"} — ${template.sections.length} secciones`);

  try {
    const ok = await printerRenderer.imprimirConPlantilla(config, datos, template);
    if (ok) {
      logPrinter.info(`Impresión completada: ${jobId}`);
      return true;
    } else {
      logPrinter.error(`Impresión falló (renderer devolvió false): ${jobId}`);
      return false;
    }
  } catch (err) {
    logPrinter.error(`Error al imprimir ${jobId}:`, err.message);
    return false;
  }
}

/* ==========================
   Notificar al servidor
   ========================== */
async function notifyJobProcessing(jobId, datos, attempt = 1) {
  try {
    const payload = { jobId, attempt };
    if (datos) {
      if (datos.orderId) payload.orderId = datos.orderId;
      if (datos.printerName) payload.printerName = datos.printerName;
    }

    await fetch(`${API_BASE}/api/job-processing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logNotify.error("No se pudo notificar processing:", err.message);
  }
}

async function notifyJobCompleted(jobId, datos) {
  try {
    const payload = { jobId };
    if (datos) {
      if (datos.orderId) payload.orderId = datos.orderId;
      if (datos.printerName) payload.printerName = datos.printerName;
      if (datos._templateInfo?.logId) payload.logId = datos._templateInfo.logId;
    }

    await fetch(`${API_BASE}/api/job-completed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logNotify.error("No se pudo notificar completado:", err.message);
  }
}

async function notifyJobFailed(jobId, error, datos) {
  try {
    const payload = {
      jobId,
      error: error.message
    };

    // Add additional metadata for the frontend
    if (datos) {
      if (datos.orderId) payload.orderId = datos.orderId;
      if (datos.printerName) payload.printerName = datos.printerName;
      if (datos._printer && datos._printer.ip) payload.printerIp = datos._printer.ip;
      if (datos._templateInfo?.logId) payload.logId = datos._templateInfo.logId;
    }

    await fetch(`${API_BASE}/api/job-failed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logNotify.error("No se pudo notificar fallo:", err.message);
  }
}

/* ==========================
   Estado de Reintentos (Retries)
   ========================== */
const retryStates = {}; // { [filename]: { count, nextRetryTime } }

// Una impresora procesa un job a la vez — todas las impresoras corren en paralelo
const processingByPrinter = {}; // { [printerKey]: boolean }

/* ==========================
   Procesador de un job individual
   ========================== */
async function processJobFile(file, datos) {
  const jobPath       = path.join(queueDir, file);
  const processingPath = path.join(processingDir, file);
  const jobId         = datos._templateInfo?.jobId || file.replace(".json", "");
  const currentAttempt = retryStates[file] ? retryStates[file].count + 1 : 1;

  if (!fs.existsSync(processingDir)) fs.mkdirSync(processingDir, { recursive: true });

  try {
    fs.renameSync(jobPath, processingPath);
  } catch {
    // El archivo ya fue tomado por un ciclo anterior — ignorar silenciosamente
    throw new Error("Job ya procesado por otro ciclo");
  }

  await notifyJobProcessing(jobId, datos, currentAttempt);

  const startTime = Date.now();
  const success   = await handleImpresion(datos);
  const duration  = Date.now() - startTime;

  if (!success) throw new Error("HandleImpresion devolvió falso indicando fallo interno");

  logQueue.info(`Completado en ${duration}ms — ${jobId}`);
  fs.unlinkSync(processingPath);
  delete retryStates[file];
  await notifyJobCompleted(jobId, datos);
  await confirmPrintOnFirestore(datos, "printed");
  await new Promise((r) => setTimeout(r, 200));
}

/* ==========================
   Worker por impresora — maneja reintentos y limpia el lock al terminar
   ========================== */
async function processJobForPrinter(file, datos, printerKey) {
  const jobPath        = path.join(queueDir, file);
  const processingPath = path.join(processingDir, file);
  const jobId          = file.replace(".json", "");

  try {
    await processJobFile(file, datos);
  } catch (err) {
    if (err.message === "Job ya procesado por otro ciclo") return;

    logQueue.error(`Error procesando ${jobId} [${printerKey}]: ${err.message}`);

    if (!retryStates[file]) retryStates[file] = { count: 0, nextRetryTime: 0 };
    retryStates[file].count += 1;

    if (retryStates[file].count <= MAX_RETRIES) {
      const delayMs = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryStates[file].count - 1), MAX_RETRY_DELAY_MS);
      retryStates[file].nextRetryTime = Date.now() + delayMs;
      logQueue.warn(`Reintento ${retryStates[file].count}/${MAX_RETRIES} en ${delayMs / 1000}s — ${jobId}`);
      if (fs.existsSync(processingPath)) fs.renameSync(processingPath, jobPath);
    } else {
      logQueue.error(`Reintentos agotados — ${jobId} marcado como fallido definitivo`);
      let failedDatos = {};
      try { failedDatos = JSON.parse(fs.readFileSync(processingPath, "utf8")); } catch (e) {
        logQueue.error(`No se pudieron leer los datos del job fallido:`, e.message);
      }
      await notifyJobFailed(jobId, err, failedDatos);
      await confirmPrintOnFirestore(failedDatos, "failed_printer");
      delete retryStates[file];
      const failedDir = process.env.TEST_FAILED_DIR ?? path.join(ROOT_DIR, "print-failed");
      if (!fs.existsSync(failedDir)) fs.mkdirSync(failedDir, { recursive: true });
      if (fs.existsSync(processingPath)) {
        try { fs.renameSync(processingPath, path.join(failedDir, file)); } catch (e) {
          logQueue.error(`No se pudo mover job a print-failed/:`, e.message);
        }
      }
    }
  } finally {
    processingByPrinter[printerKey] = false;
  }
}

/* ==========================
   Despachador de cola — lanza un worker por impresora en paralelo
   ========================== */
function processPrintQueue() {
  if (!fs.existsSync(queueDir)) return;

  let files;
  try {
    files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    logQueue.error("Error leyendo directorio de cola:", err.message);
    return;
  }

  if (files.length === 0) return;

  logQueue.debug(`Evaluando cola: ${files.length} trabajo(s) pendiente(s)`);

  for (const file of files) {
    // Saltar si el job está en cooldown de retry
    const state = retryStates[file];
    if (state && Date.now() < state.nextRetryTime) continue;

    // Leer el job para obtener a qué impresora va
    let datos;
    try {
      datos = JSON.parse(fs.readFileSync(path.join(queueDir, file), "utf8"));
    } catch { continue; }

    const printerKey = `${datos._printer?.ip}:${datos._printer?.port || 9100}`;

    // Si esta impresora ya está ocupada, saltar (no bloquear las demás)
    if (processingByPrinter[printerKey]) continue;

    // Despachar sin bloquear — cada impresora tiene su propio ciclo de vida
    processingByPrinter[printerKey] = true;
    processJobForPrinter(file, datos, printerKey); // intencionalmente sin await
  }
}

/* ==========================
   Watcher de config
   ========================== */
let lastConfigChange = 0;
fs.watchFile(configPath, () => {
  const now = Date.now();

  if (now - lastConfigChange < 100) {
    return;
  }
  lastConfigChange = now;

  logConfig.info("config.json modificado — recargando");
  reiniciarConector(true);
});

/* ==========================
   Estructura de directorios
   ========================== */
function crearEstructuraDirectorios() {
  const assetsDir = path.join(ROOT_DIR, "assets");
  const fontsDir = path.join(assetsDir, "fonts");
  const fontsCacheDir = path.join(fontsDir, "cache");
  const logosDir = path.join(assetsDir, "logos");
  const failedDir = path.join(ROOT_DIR, "print-failed");

  const dirs = [
    [assetsDir,     "assets"],
    [fontsDir,      "fonts"],
    [fontsCacheDir, "fonts/cache"],
    [logosDir,      "logos"],
    [queueDir,      "print-queue"],
    [processingDir, "print-processing"],
    [failedDir,     "print-failed"],
    [confirmDir,    "pending-confirmations"],
  ];

  for (const [dir, name] of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logConfig.info(`Directorio creado: ${name}/`);
    }
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

// Retry de confirmaciones pendientes en Firestore cada 30 segundos
setInterval(() => {
  processPendingConfirmations().catch((err) => logConfirm.error("Error en procesamiento de confirmaciones:", err.message));
}, 30000);


/* ==========================
   Run
   ========================== */
crearEstructuraDirectorios();
reiniciarConector();
