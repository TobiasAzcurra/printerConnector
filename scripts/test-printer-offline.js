// scripts/test-printer-offline.js
// Simula impresoras no disponibles inyectando jobs con IPs inexistentes.
// Verifica que el conector reintenta MAX_RETRIES veces con backoff exponencial
// y luego mueve los jobs a print-failed/.
//
// Duración real estimada: ~4 minutos (5 reintentos × backoff + TCP timeouts)

const fs   = require("fs");
const path = require("path");

const ROOT_DIR  = path.join(__dirname, "..");
const queueDir  = path.join(ROOT_DIR, "print-queue");
const failedDir = path.join(ROOT_DIR, "print-failed");

// IPs que nunca van a contestar
const BOGUS_IPS = ["10.0.0.254", "10.0.0.253"];
const JOB_COUNT = 2; // uno por IP

// Tiempos reales del código:
// MAX_RETRIES = 5, backoff = 5000 * 2^(attempt-1) → 5s, 10s, 20s, 40s, 80s
// TCP timeout de node-thermal-printer ≈ 3-5s por intento
// Con 2 jobs procesados secuencialmente por tick:
// Tiempo total estimado: ~4-5 minutos
const POLL_MS        = 5000;
const TIMEOUT_S      = 360; // 6 min de margen

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function buildTestJob(index) {
  const jobId = `test-offline-${Date.now()}-${index}`;
  return {
    jobId,
    data: {
      _printer: { ip: BOGUS_IPS[index % BOGUS_IPS.length], port: 9100 },
      _template: {
        sections: [
          { type: "text", text: `OFFLINE TEST #${index + 1}`, style: { align: "center", bold: true } },
          { type: "text", text: `IP: ${BOGUS_IPS[index % BOGUS_IPS.length]}`,  style: { align: "center" } },
          { type: "spacer" },
        ],
      },
      _templateInfo: {
        id:        "test-offline",
        jobId,
        timestamp: new Date().toISOString(),
      },
    },
  };
}

async function main() {
  console.log("\n" + "━".repeat(55));
  console.log("  TEST — PRINTER OFFLINE (retry + backoff)");
  console.log("━".repeat(55) + "\n");

  if (!fs.existsSync(queueDir))  fs.mkdirSync(queueDir,  { recursive: true });
  if (!fs.existsSync(failedDir)) fs.mkdirSync(failedDir, { recursive: true });

  // 1. Inyectar jobs con IP inexistente en print-queue/
  const jobs = [];
  console.log(`📋 Inyectando ${JOB_COUNT} job(s) con IPs inexistentes...\n`);

  for (let i = 0; i < JOB_COUNT; i++) {
    const { jobId, data } = buildTestJob(i);
    const jobPath = path.join(queueDir, `${jobId}.json`);
    fs.writeFileSync(jobPath, JSON.stringify(data, null, 2));
    jobs.push(jobId);
    console.log(`   📋 Job ${i + 1}: ${jobId}`);
    console.log(`        IP destino : ${BOGUS_IPS[i % BOGUS_IPS.length]} (inexistente)`);
  }

  console.log(`\n⚠️  Comportamiento esperado por job:`);
  console.log(`   Intento 1 → falla → espera 5s`);
  console.log(`   Intento 2 → falla → espera 10s`);
  console.log(`   Intento 3 → falla → espera 20s`);
  console.log(`   Intento 4 → falla → espera 40s`);
  console.log(`   Intento 5 → falla → mueve a print-failed/`);
  console.log(`\n   Timeout máximo configurado: ${TIMEOUT_S}s\n`);

  // 2. Polling hasta que todos estén en print-failed/
  const deadline  = Date.now() + TIMEOUT_S * 1000;
  const startTime = Date.now();

  while (true) {
    const inFailed  = jobs.filter((id) => fs.existsSync(path.join(failedDir, `${id}.json`)));
    const inQueue   = jobs.filter((id) => fs.existsSync(path.join(queueDir,  `${id}.json`)));
    const allDone   = inFailed.length === jobs.length && inQueue.length === 0;

    if (allDone) {
      process.stdout.write("\r" + " ".repeat(80) + "\r");
      console.log("✅ Todos los jobs llegaron a print-failed/\n");
      break;
    }

    if (Date.now() >= deadline) {
      process.stdout.write("\r" + " ".repeat(80) + "\r");
      console.log(`⏱️  Timeout (${TIMEOUT_S}s) alcanzado. Resultados parciales:\n`);
      break;
    }

    const elapsed   = Math.ceil((Date.now() - startTime) / 1000);
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write(
      `\r⏳ ${elapsed}s transcurridos | ${inFailed.length}/${jobs.length} en print-failed/ | ${remaining}s restantes`
    );
    await sleep(POLL_MS);
  }

  // 3. Reporte
  const elapsedTotal = Math.ceil((Date.now() - startTime) / 1000);

  console.log("━".repeat(55));
  console.log("  RESULTADO");
  console.log("━".repeat(55));
  console.log(`  Tiempo total real: ${elapsedTotal}s\n`);

  let allOk = true;
  for (const jobId of jobs) {
    const inFailed = fs.existsSync(path.join(failedDir, `${jobId}.json`));
    const inQueue  = fs.existsSync(path.join(queueDir,  `${jobId}.json`));
    const ok       = inFailed && !inQueue;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✅" : "❌"}  ${jobId}`);
    console.log(`       print-failed/ : ${inFailed ? "Sí" : "No"}  |  print-queue/ : ${inQueue ? "Sí (incompleto)" : "No"}`);
  }

  console.log();
  if (allOk) {
    console.log("✅ PASS — Todos los jobs agotaron reintentos y quedaron en print-failed/.\n");
  } else {
    console.log("❌ FAIL — Algún job no completó el ciclo de reintentos.\n");
  }

  // 4. Limpiar jobs de prueba de print-failed/
  console.log("🧹 Limpiando jobs de prueba de print-failed/...");
  for (const jobId of jobs) {
    const p = path.join(failedDir, `${jobId}.json`);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`   🗑️  ${jobId} eliminado`);
    }
  }
  console.log();
  process.exit(0);
}

main().catch((e) => { console.error("❌ Error:", e.message); process.exit(1); });
