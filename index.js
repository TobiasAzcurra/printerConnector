// index.js
const fs   = require("fs");
const path = require("path");
const net  = require("net");
const printerRenderer = require("./src/printer-renderer");

const ROOT_DIR = __dirname;
const configPath      = path.join(ROOT_DIR, "config.json");
const queueDir        = path.join(ROOT_DIR, "print-queue");
const processingDir   = path.join(ROOT_DIR, "print-processing");
const confirmDir      = path.join(ROOT_DIR, "pending-confirmations");

const API_BASE = "http://localhost:4040";

let config = {};
let isProcessingQueue = false;



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
    console.log(
      "No se encontró config.json. Se creó uno por defecto. Editalo desde el navegador."
    );
    process.exit(0);
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(raw);

    if (config.useHeaderLogo === undefined) config.useHeaderLogo = true;
    if (config.useFooterLogo === undefined) config.useFooterLogo = true;
    if (config.useFontTicket === undefined) config.useFontTicket = false;
    if (!config.assets) config.assets = {};


    console.log("Config cargada:", {
      ...config,
      assets: Object.fromEntries(
        Object.entries(config.assets || {}).map(([k, v]) => [
          k,
          { ...v, path: v?.path },
        ])
      ),
    });
  } catch (err) {
    console.error("Error al leer config.json:", err);
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
    console.warn("[Confirm] Job sin logId u orderId — omitiendo confirmación");
    return;
  }

  if (!config.confirmPrintUrl || !config.enterpriseId || !config.sucursalId || !config.apiKey) {
    console.warn("[Confirm] Config incompleta (faltan confirmPrintUrl, enterpriseId, sucursalId o apiKey)");
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
    console.log(`[Confirm] ✅ Firestore confirmado: ${logId} → ${status}`);
  } catch (err) {
    console.warn(`[Confirm] ⚠️ Falló confirmación (se reintentará en background): ${err.message}`);
  }
}

async function processPendingConfirmations() {
  if (!fs.existsSync(confirmDir)) return;
  if (!config.confirmPrintUrl || !config.enterpriseId || !config.sucursalId || !config.apiKey) return;

  const files = fs.readdirSync(confirmDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return;

  console.log(`[Confirm] Procesando ${files.length} confirmaciones pendientes...`);

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
      console.log(`[Confirm] ✅ Confirmación pendiente resuelta: ${data.logId}`);
    } catch (err) {
      data.retries = (data.retries || 0) + 1;
      if (data.retries > 20) {
        console.error(`[Confirm] ⛔ Confirmación abandonada tras 20 intentos: ${data.logId}`);
        const abandonedDir = path.join(confirmDir, "abandoned");
        if (!fs.existsSync(abandonedDir)) fs.mkdirSync(abandonedDir, { recursive: true });
        fs.renameSync(filePath, path.join(abandonedDir, file));
      } else {
        fs.writeFileSync(filePath, JSON.stringify(data));
        console.warn(`[Confirm] ⚠️ Reintento ${data.retries}/20 fallido para ${data.logId}: ${err.message}`);
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

  console.log(`⚠️  Recuperando ${orphans.length} job(s) huérfano(s) de print-processing/...`);

  for (const file of orphans) {
    const from = path.join(processingDir, file);
    const to   = path.join(queueDir, file);
    try {
      fs.renameSync(from, to);
      console.log(`  ↩️  ${file} → print-queue/`);
    } catch (err) {
      console.error(`  ❌ No se pudo recuperar ${file}:`, err.message);
    }
  }
}

/* ==========================
   Reinicio del conector
   ========================== */
function reiniciarConector() {
  console.log("Recargando configuración...");
  cargarConfig();
  recoverOrphanedJobs();
  processPendingConfirmations().catch(console.error);
  processPrintQueue();
}

/* ==========================
   Handler de impresión
   ========================== */
async function handleImpresion(datos) {
  const jobId = datos._templateInfo?.jobId || "Sin ID";
  console.log("Trabajo de impresión recibido:", jobId);

  const template = datos._template;

  if (!template || !Array.isArray(template.sections)) {
    console.error(
      `❌ Job "${jobId}" rechazado: el payload no incluye _template.sections.`
    );
    return false;
  }

  console.log(
    `📐 Template: ${datos._templateInfo?.id || "sin id"} — ${template.sections.length} secciones`
  );

  try {
    const ok = await printerRenderer.imprimirConPlantilla(config, datos, template);
    if (ok) {
      console.log(`Impresión completada exitosamente: ${jobId}`);
      return true;
    } else {
      console.error(`Error durante la impresión: ${jobId}`);
      return false;
    }
  } catch (err) {
    console.error(`Error al imprimir ${jobId}:`, err);
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
    console.error("No se pudo notificar processing:", err.message);
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
    console.error("No se pudo notificar completado:", err.message);
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
    console.error("No se pudo notificar fallo:", err.message);
  }
}

/* ==========================
   Estado de Reintentos (Retries)
   ========================== */
const MAX_RETRIES = 5;
const retryStates = {}; // { [filename]: { count: 0, nextRetryTime: 0 } }

/* ==========================
   Procesador de cola
   ========================== */
async function processPrintQueue() {
  if (isProcessingQueue) {
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

    if (files.length > 0) {
      console.log(`\n--- Evaluando Cola: ${files.length} trabajos ---`);
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const jobPath = path.join(queueDir, file);
      const processingPath = path.join(processingDir, file);

      // Chequear si el job está en cooldown de retry
      const state = retryStates[file];
      if (state && Date.now() < state.nextRetryTime) {
        continue;
      }

      console.log(`[▶] Procesando: ${file}`);

      try {
        if (!fs.existsSync(processingDir)) {
          fs.mkdirSync(processingDir, { recursive: true });
        }

        fs.renameSync(jobPath, processingPath);

        const jobContent = fs.readFileSync(processingPath, "utf8");
        const datos = JSON.parse(jobContent);

        const jobId = datos._templateInfo?.jobId || file.replace(".json", "");

        // Calcular en qué intento estamos
        const stateForAttempt = retryStates[file];
        const currentAttempt = stateForAttempt ? stateForAttempt.count + 1 : 1;

        const startTime = Date.now();
        
        // Notify the frontend that we are about to lock this ticket for processing
        await notifyJobProcessing(jobId, datos, currentAttempt);
        
        const success = await handleImpresion(datos);
        const duration = Date.now() - startTime;

        if (success) {
          console.log(`  ✅ Completado en ${duration}ms (${jobId})`);
          fs.unlinkSync(processingPath);

          delete retryStates[file];

          await notifyJobCompleted(jobId, datos);
          await confirmPrintOnFirestore(datos, "printed");
        } else {
          throw new Error("HandleImpresion devolvió falso indicando fallo interno");
        }

        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        const jobId = file.replace(".json", "");
        console.error(`  ❌ Error procesando ${jobId}: ${err.message}`);

        // Lógica de Reintentos
        if (!retryStates[file]) {
          retryStates[file] = { count: 0, nextRetryTime: 0 };
        }

        retryStates[file].count += 1;

        if (retryStates[file].count <= MAX_RETRIES) {
          // Calcular backoff (ej: 5s, 10s, 20s, 40s, 80s)
          const delayMs = 5000 * Math.pow(2, retryStates[file].count - 1);
          retryStates[file].nextRetryTime = Date.now() + delayMs;

          console.log(`  🔄 Reintento ${retryStates[file].count}/${MAX_RETRIES} programado en ${delayMs/1000}s`);

          // Mover de vuelta a la cola
          if (fs.existsSync(processingPath)) {
            fs.renameSync(processingPath, jobPath);
          }
        } else {
          console.error(`  ⛔ Reintentos agotados para ${jobId}. Definitivamente fallido.`);
          // Read the original data again just in case we need it for notification
          let failedDatos = {};
          try {
            failedDatos = JSON.parse(fs.readFileSync(processingPath, "utf8"));
          } catch (e) {
            console.error(`  No se pudieron leer los datos para notificar:`, e.message);
          }
          await notifyJobFailed(jobId, err, failedDatos);
          await confirmPrintOnFirestore(failedDatos, "failed_printer");
          delete retryStates[file];

          // Mover a carpeta de fallidos
          const failedDir = path.join(ROOT_DIR, "print-failed");
          if (!fs.existsSync(failedDir)) {
            fs.mkdirSync(failedDir, { recursive: true });
          }

          if (fs.existsSync(processingPath)) {
            try {
              const failedPath = path.join(failedDir, file);
              fs.renameSync(processingPath, failedPath);
            } catch (e) {
              console.error(`  No se pudo mover a fallidos:`, e.message);
            }
          }
        }
      }
    }


  } catch (err) {
    console.error("Error general en procesamiento de cola:", err);
  } finally {
    isProcessingQueue = false;
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

  console.log("config.json modificado. Recargando...");
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

  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    console.log("Carpeta de assets creada");
  }
  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
    console.log("Carpeta de fuentes creada");
  }
  if (!fs.existsSync(fontsCacheDir)) {
    fs.mkdirSync(fontsCacheDir, { recursive: true });
    console.log("Carpeta de caché de fuentes creada");
  }
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
    console.log("Carpeta de logos creada");
  }
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
    console.log("Carpeta de cola de impresión creada");
  }
  if (!fs.existsSync(processingDir)) {
    fs.mkdirSync(processingDir, { recursive: true });
    console.log("Carpeta de procesamiento creada");
  }
  if (!fs.existsSync(failedDir)) {
    fs.mkdirSync(failedDir, { recursive: true });
    console.log("Carpeta de fallidos creada");
  }
  if (!fs.existsSync(confirmDir)) {
    fs.mkdirSync(confirmDir, { recursive: true });
    console.log("Carpeta de confirmaciones pendientes creada");
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
  processPendingConfirmations().catch(console.error);
}, 30000);


/* ==========================
   Run
   ========================== */
crearEstructuraDirectorios();
reiniciarConector();
