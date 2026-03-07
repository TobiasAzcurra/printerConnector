// scripts/test-orphan-recovery.js
// Simula un crash del conector mientras un job estaba en print-processing/
// y verifica que al reiniciar, el job se recupera y se procesa.

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR       = path.join(__dirname, "..");
const processingDir  = path.join(ROOT_DIR, "print-processing");
const queueDir       = path.join(ROOT_DIR, "print-queue");
const failedDir      = path.join(ROOT_DIR, "print-failed");

// Usamos IP real para que el job realmente se procese (y salga una hoja de prueba)
const PRINTER_IP   = "192.168.0.169"; // Mostrador
const TEST_JOB_ID  = `test-orphan-${Date.now()}`;

const TEST_JOB = {
  _printer: { ip: PRINTER_IP, port: 9100 },
  _template: {
    sections: [
      { type: "text", text: "--- ORPHAN RECOVERY TEST ---", style: { align: "center", bold: true } },
      { type: "text", text: new Date().toLocaleString("es-AR"), style: { align: "center" } },
      { type: "text", text: "Job recuperado de print-processing/", style: { align: "center" } },
      { type: "spacer" },
    ],
  },
  _templateInfo: {
    id:        "test-orphan",
    jobId:     TEST_JOB_ID,
    timestamp: new Date().toISOString(),
  },
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log("\n" + "━".repeat(55));
  console.log("  TEST — ORPHAN RECOVERY");
  console.log("━".repeat(55) + "\n");

  // 1. Asegurar carpetas
  if (!fs.existsSync(processingDir)) fs.mkdirSync(processingDir, { recursive: true });
  if (!fs.existsSync(queueDir))      fs.mkdirSync(queueDir,      { recursive: true });

  // 2. Escribir job directamente en print-processing/ (simula crash post-renameSync)
  const processingPath = path.join(processingDir, `${TEST_JOB_ID}.json`);
  fs.writeFileSync(processingPath, JSON.stringify(TEST_JOB, null, 2));

  console.log(`📋 Job huérfano creado en print-processing/`);
  console.log(`   ID     : ${TEST_JOB_ID}`);
  console.log(`   Estado : simulando crash post-renameSync, pre-impresión\n`);

  console.log(`   print-processing/ : ✅ Sí`);
  console.log(`   print-queue/      : ❌ No (correcto — el conector normal no lo vería)\n`);

  // 3. Reiniciar conector
  console.log("🔄 Reiniciando printer-connector via PM2...");
  try {
    execSync("pm2 restart printer-connector", { stdio: "pipe" });
    console.log("   Conector reiniciado.\n");
  } catch (e) {
    console.error("❌ Error al reiniciar PM2:", e.message);
    process.exit(1);
  }

  // 4. Esperar a que arranque, recupere, e intente imprimir
  // El conector corre processPrintQueue() inmediatamente al arrancar
  // + TCP a impresora puede tardar ~3-5s si está online
  console.log("⏳ Esperando 15s para que el conector recupere y procese el job...\n");
  await sleep(15000);

  // 5. Verificar resultado
  const stillProcessing = fs.existsSync(processingPath);
  const nowInQueue      = fs.existsSync(path.join(queueDir,  `${TEST_JOB_ID}.json`));
  const inFailed        = fs.existsSync(path.join(failedDir, `${TEST_JOB_ID}.json`));
  const completed       = !stillProcessing && !nowInQueue && !inFailed;

  console.log("━".repeat(55));
  console.log("  RESULTADO");
  console.log("━".repeat(55));
  console.log(`   print-processing/ : ${stillProcessing ? "❌ Sigue ahí — recovery no funcionó"  : "✅ Vacío"}`);
  console.log(`   print-queue/      : ${nowInQueue      ? "⚠️  Sigue en cola (retry pendiente)"   : "✅ Vacío"}`);
  console.log(`   print-failed/     : ${inFailed        ? "⚠️  Falló al imprimir (impresora off?)" : "✅ No"}`);

  console.log();
  if (completed) {
    console.log("✅ PASS — Job recuperado y procesado exitosamente.");
    console.log("   Revisá Mostrador: debería haber salido una hoja de prueba.\n");
  } else if (!stillProcessing && nowInQueue) {
    console.log("⚠️  Job recuperado pero aún en cola (retry). Esperá unos segundos más.\n");
  } else if (stillProcessing) {
    console.log("❌ FAIL — El job sigue en print-processing/. Recovery no funcionó.\n");
  } else if (inFailed) {
    console.log("⚠️  Job recuperado pero la impresora no respondió → print-failed/.\n");
    // Limpiar
    fs.unlinkSync(path.join(failedDir, `${TEST_JOB_ID}.json`));
    console.log("   Job de prueba eliminado de print-failed/.\n");
  }

  process.exit(0);
}

main().catch((e) => { console.error("❌ Error:", e.message); process.exit(1); });
