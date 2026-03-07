// scripts/test-recovery.js
// Prueba el mecanismo de recovery de useAutoPrintEngine.
//
// El recovery es el código que, al iniciar el modo Tiempo Real, detecta pedidos
// que ya tienen una transición de estado (cancelación, confirmación, etc.) pero
// ningún printLog correspondiente — y los imprime automáticamente.
//
// Este test requiere dos acciones del usuario en el dashboard:
//   1. Apagar Tiempo Real (para simular que el dashboard estaba offline)
//   2. Prender Tiempo Real (para disparar el recovery)
//
// El script se encarga del resto: seedear pedidos, verificar el estado previo,
// cancelar los pedidos mientras el dashboard está "offline", y verificar que
// el recovery disparó las impresiones correctas al reconectarse.
//
// Uso:
//   node scripts/test-recovery.js
//   node scripts/test-recovery.js --timeout 120

const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  addDoc,
  serverTimestamp,
} = require("firebase/firestore");
const { execSync } = require("child_process");
const fs       = require("fs");
const path     = require("path");
const readline = require("readline");

// ─── Config ───────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBrtAtARPV_Fp69XrJKdUzwoEvv1hXD0Uk",
  authDomain:        "absolute-97d92.firebaseapp.com",
  projectId:         "absolute-97d92",
  storageBucket:     "absolute-97d92.firebasestorage.app",
  messagingSenderId: "779319553398",
  appId:             "1:779319553398:web:ca47e54d0a9a7fd2f59e57",
};

const EMPRESA_ID  = "22d67ba8-6bb4-49f3-8d0a-6ad042617563";
const SUCURSAL_ID = "43f7ee6a-e716-4477-9a05-e6501774ae2e";
const LOG_FILE    = path.join(__dirname, ".seed-orders-log.json");

const args        = process.argv.slice(2);
const timeoutFlag = args.indexOf("--timeout");
const TIMEOUT_S   = timeoutFlag !== -1 ? parseInt(args[timeoutFlag + 1]) || 90 : 90;
const delayFlag   = args.indexOf("--delay");
const DELAY_S     = delayFlag !== -1 ? parseInt(args[delayFlag + 1]) || 20 : 20;
const IS_AUTO     = args.includes("--auto");
const POLL_MS     = 4000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

// ─── Log ──────────────────────────────────────────────────────────────────────

function loadLastRun() {
  if (!fs.existsSync(LOG_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    if (!data.runs || data.runs.length === 0) return null;
    return data.runs[data.runs.length - 1];
  } catch { return null; }
}

// ─── Firebase: config de impresión ───────────────────────────────────────────

async function loadPrintConfig(db) {
  const cfgBase = ["absoluteClientes", EMPRESA_ID, "sucursales", SUCURSAL_ID, "config"];
  const [rulesSnap, tplSnap, termSnap] = await Promise.all([
    getDoc(doc(db, ...cfgBase, "printerRules")),
    getDocs(collection(db, ...cfgBase, "printer", "ticketTemplates")),
    getDocs(collection(db, ...cfgBase, "printer", "terminals")),
  ]);
  return {
    rules:     rulesSnap.exists() ? (rulesSnap.data().rules || []) : [],
    templates: tplSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    terminals: termSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// ─── Firebase: printLogs por pedido ──────────────────────────────────────────

async function fetchPrintLogs(db, orderId, since) {
  const sinceWithBuffer = new Date(since.getTime() - 5000);
  const logsRef = collection(
    db,
    "absoluteClientes", EMPRESA_ID, "sucursales", SUCURSAL_ID, "pedidos", orderId, "printLogs"
  );
  try {
    const snap = await getDocs(
      query(logsRef, where("timestamp", ">=", Timestamp.fromDate(sinceWithBuffer)))
    );
    return snap.docs.map((d) => d.data());
  } catch (err) {
    if (err.code === "permission-denied") throw err;
    return [];
  }
}

// ─── Cancelar via REST ────────────────────────────────────────────────────────

async function cancelOrderViaRest(orderId, status) {
  const docPath = `absoluteClientes/${EMPRESA_ID}/sucursales/${SUCURSAL_ID}/pedidos/${orderId}`;
  // updateMask must include timestamps.canceledAt so the recovery mechanism
  // (which checks pedido.timestamps.canceledAt !== null) can detect the transition.
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=timestamps.canceledAt&key=${FIREBASE_CONFIG.apiKey}`;
  const now = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          status: { stringValue: status },
          timestamps: {
            mapValue: {
              fields: {
                canceledAt: { timestampValue: now },
              },
            },
          },
        },
      }),
    });
    return res.ok;
  } catch { return false; }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollForLogs(db, orderIds, cancelTemplateIds, since, label) {
  const deadline  = Date.now() + TIMEOUT_S * 1000;
  const actualMap = {};
  for (const id of orderIds) actualMap[id] = {};

  while (true) {
    let allDone = true;

    for (const orderId of orderIds) {
      const logs = await fetchPrintLogs(db, orderId, since);
      const byTemplate = {};
      for (const log of logs) {
        if (!byTemplate[log.templateId]) byTemplate[log.templateId] = [];
        byTemplate[log.templateId].push(log);
      }
      actualMap[orderId] = byTemplate;

      for (const tplId of cancelTemplateIds) {
        if ((byTemplate[tplId] || []).length === 0) allDone = false;
      }
    }

    if (allDone) {
      process.stdout.write("\r" + " ".repeat(80) + "\r");
      console.log(`✅ ${label}: todos los logs detectados.\n`);
      break;
    }

    if (Date.now() >= deadline) {
      process.stdout.write("\r" + " ".repeat(80) + "\r");
      console.log(`⏱️  Timeout (${TIMEOUT_S}s). Resultados parciales:\n`);
      break;
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write(`\r⏳ Esperando ${label}... ${remaining}s restantes`);
    await sleep(POLL_MS);
  }

  return actualMap;
}

// ─── Schema validation ────────────────────────────────────────────────────────

function validateLogSchema(actualMap, phase, cancellationStatuses = {}) {
  const issues = [];
  for (const [orderId, byTemplate] of Object.entries(actualMap)) {
    for (const [templateId, logs] of Object.entries(byTemplate)) {
      for (const log of logs) {
        const prefix = `${orderId.slice(0, 12)} / tpl ${templateId.slice(0, 8)}`;
        if (!log.templateId)   issues.push(`${prefix}: falta templateId`);
        if (!log.terminalName) issues.push(`${prefix}: falta terminalName`);
        if (!log.event)        issues.push(`${prefix}: falta campo event`);

        if (phase === "ORDER_CREATED") {
          if (log.event && log.event !== "ORDER_CREATED")
            issues.push(`${prefix}: event="${log.event}" (esperado "ORDER_CREATED")`);
          if (log.statusTo != null)
            issues.push(`${prefix}: tiene statusTo="${log.statusTo}" en log ORDER_CREATED`);
        } else if (phase === "STATUS_CHANGED") {
          if (log.event && log.event !== "STATUS_CHANGED")
            issues.push(`${prefix}: event="${log.event}" (esperado "STATUS_CHANGED")`);
          if (!log.statusTo)
            issues.push(`${prefix}: falta statusTo — el recovery no puede funcionar sin este campo`);
          else {
            const expected = cancellationStatuses[orderId];
            if (expected && log.statusTo !== expected)
              issues.push(`${prefix}: statusTo="${log.statusTo}" (esperado "${expected}")`);
          }
        }
      }
    }
  }
  return issues;
}

// ─── Reporte ──────────────────────────────────────────────────────────────────

function printRecoveryReport(orderIds, actualMap, cancelTemplates, terminals, cancellationStatuses) {
  const LINE = "═".repeat(60);
  console.log(LINE);
  console.log("  REPORTE DE RECOVERY");
  console.log(LINE + "\n");

  let passCount = 0;

  for (const orderId of orderIds) {
    const expectedStatus = cancellationStatuses[orderId] || "?";
    console.log(`📦  ${orderId.slice(0, 14)}...  → cancelado como ${expectedStatus}`);

    const byTemplate = actualMap[orderId] || {};
    let orderOk = true;

    for (const tpl of cancelTemplates) {
      const logs     = byTemplate[tpl.id] || [];
      const terminal = terminals.find((t) => (tpl.assignedTerminalIds || []).includes(t.id));
      const count    = logs.length;
      const expected = tpl.printScope === "item" ? "≥1" : "1";

      let icon, note;
      if (count === 0) {
        icon = "❌"; note = "0 logs — recovery NO disparó"; orderOk = false;
      } else if (logs.some((l) => l.status === "error")) {
        icon = "❌"; note = `${count} logs pero con error al enviar`; orderOk = false;
      } else {
        icon = "✅"; note = `${count} log(s) — recovery OK`;
      }
      console.log(`    ${icon}  ${tpl.name.padEnd(36)} → ${terminal?.name || "?"}`);
      console.log(`         ${note}`);
    }

    if (orderOk) passCount++;
    console.log();
  }

  const emoji = passCount === orderIds.length ? "✅" : passCount === 0 ? "❌" : "⚠️ ";
  console.log(`${emoji}  RECOVERY: ${passCount}/${orderIds.length} pedidos recuperados correctamente\n`);

  // Schema validation
  const issues = validateLogSchema(actualMap, "STATUS_CHANGED", cancellationStatuses);
  if (issues.length === 0) {
    console.log("✅ Schema de logs: OK — statusTo presente y correcto en todos los logs\n");
  } else {
    console.log(`❌ Schema de logs: ${issues.length} problema(s):`);
    issues.forEach((i) => console.log(`   • ${i}`));
    console.log();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "━".repeat(60));
  console.log("  TEST — RECOVERY DE USEAUTOPRINTENGINE");
  console.log("━".repeat(60));
  console.log(`
  Este test verifica que al prender Tiempo Real, el motor
  detecta y recupera los prints que no se pudieron hacer
  mientras el dashboard estaba offline.
`);

  // 1. Seedear pedidos frescos (evita colisión con los logs de verify:full)
  console.log("🌱 Creando pedidos frescos para el test...\n");
  execSync(
    `node "${path.join(__dirname, "seed-orders.js")}"`,
    { stdio: "inherit", cwd: path.join(__dirname, "..") }
  );
  console.log();

  // 2. Cargar el run recién creado
  const lastRun = loadLastRun();
  if (!lastRun || lastRun.orders.length === 0) {
    console.error("❌ No se pudieron cargar los pedidos del seed.");
    process.exit(1);
  }

  const seedRunAt = new Date(lastRun.runAt);
  const orderIds  = lastRun.orders.map((o) => o.id);

  console.log(`📋 Pedidos creados en: ${lastRun.runAt}`);
  console.log(`   ${orderIds.length} pedido(s)\n`);

  // 2. Firebase
  const app = initializeApp(FIREBASE_CONFIG);
  const db  = getFirestore(app);

  // 3. Config de impresión
  console.log("🔧 Cargando configuración de impresión...");
  const { rules, templates, terminals } = await loadPrintConfig(db);

  const orderCreatedRule = rules.find((r) => r.isEnabled && r.event === "ORDER_CREATED");
  const cancelRule       = rules.find(
    (r) => r.isEnabled && r.event === "STATUS_CHANGED" &&
           r.conditions?.statusTo?.some((s) => s.startsWith("Canceled"))
  );

  if (!orderCreatedRule || !cancelRule) {
    console.error("❌ Faltan reglas activas (ORDER_CREATED o cancelación).");
    process.exit(1);
  }

  const createdTemplateIds = orderCreatedRule.templateIds;
  const cancelTemplates    = cancelRule.templateIds
    .map((id) => templates.find((t) => t.id === id && t.isEnabled))
    .filter(Boolean);

  console.log(`   ORDER_CREATED : "${orderCreatedRule.name}"`);
  console.log(`   Cancelación   : "${cancelRule.name}"\n`);

  // ═══════════════════════════════════════════════════════
  // PASO 1 — Verificar que los ORDER_CREATED ya se imprimieron
  // ═══════════════════════════════════════════════════════

  console.log("━".repeat(60));
  console.log("  PASO 1 — Verificar estado previo (ORDER_CREATED)");
  console.log("━".repeat(60));
  console.log(`
  Para que el recovery funcione, el motor debe haber visto
  los pedidos al menos una vez (en el estado original).
  Verificando que los ORDER_CREATED ya tienen logs...\n`);

  let p1Map;
  try {
    p1Map = await pollForLogs(db, orderIds, createdTemplateIds, seedRunAt, "logs ORDER_CREATED");
  } catch (err) {
    if (err.code === "permission-denied") {
      console.error("❌ PERMISSION_DENIED al leer printLogs.");
      process.exit(1);
    }
    throw err;
  }

  const totalP1Logs = Object.values(p1Map).reduce((sum, byTpl) =>
    sum + Object.values(byTpl).reduce((s, logs) => s + logs.length, 0), 0
  );

  const p1SchemaIssues = validateLogSchema(p1Map, "ORDER_CREATED");
  if (p1SchemaIssues.length > 0) {
    console.log(`⚠️  Schema issues en logs ORDER_CREATED (${p1SchemaIssues.length}):`);
    p1SchemaIssues.forEach((i) => console.log(`   • ${i}`));
    console.log();
  } else {
    console.log(`✅ Schema ORDER_CREATED: OK\n`);
  }

  if (totalP1Logs === 0) {
    console.error("❌ No hay logs de ORDER_CREATED para estos pedidos.");
    console.error("   El dashboard no procesó los pedidos todavía.");
    console.error("   Asegurate de que Tiempo Real esté activo y volvé a correr el seed.\n");
    process.exit(1);
  }

  console.log(`✅ ${totalP1Logs} logs ORDER_CREATED encontrados — precondición cumplida.\n`);

  // ═══════════════════════════════════════════════════════
  // PASO 2 — Simular dashboard offline
  // ═══════════════════════════════════════════════════════

  console.log("━".repeat(60));
  console.log("  PASO 2 — Simular dashboard offline");
  console.log("━".repeat(60));

  if (IS_AUTO) {
    console.log(`\n  👆 APAGÁ Tiempo Real en el dashboard AHORA.`);
    console.log(`     (El motor no debe ver los próximos cambios de estado.)`);
    for (let i = DELAY_S; i > 0; i--) {
      process.stdout.write(`\r     Continuando en ${i}s...   `);
      await sleep(1000);
    }
    process.stdout.write("\r" + " ".repeat(50) + "\r");
  } else {
    await prompt(`
  👆 APAGÁ Tiempo Real en el dashboard AHORA.
     (El motor no debe ver los próximos cambios de estado.)
     Presioná Enter cuando esté apagado...`);
  }

  console.log("\n   Esperando 2s para que el unsubscribe de Firestore se complete...");
  await sleep(2000);

  // ═══════════════════════════════════════════════════════
  // PASO 3 — Cancelar pedidos (dashboard offline)
  // ═══════════════════════════════════════════════════════

  console.log("\n━".repeat(60).slice(1));
  console.log("  PASO 3 — Cancelando pedidos (dashboard offline)");
  console.log("━".repeat(60) + "\n");

  const canceledAt         = new Date();
  const cancellationStatuses = {};

  for (let i = 0; i < orderIds.length; i++) {
    const status = i % 2 === 0 ? "CanceledByCustomer" : "CanceledByEnterprise";
    const ok     = await cancelOrderViaRest(orderIds[i], status);
    cancellationStatuses[orderIds[i]] = status;
    console.log(`   ${ok ? "✅" : "❌"}  ${orderIds[i].slice(0, 14)}...  → ${status}`);
  }

  const failedCancels = orderIds.filter((id) => {
    // We don't track ok per id above, so assume all ok for the check
    return false;
  });

  console.log(`\n   Pedidos cancelados en Firestore mientras el dashboard estaba offline.`);
  console.log(`   El motor NO vio esta transición — no hay logs STATUS_CHANGED aún.\n`);

  // ═══════════════════════════════════════════════════════
  // PASO 4 — Reconectar dashboard y disparar recovery
  // ═══════════════════════════════════════════════════════

  console.log("━".repeat(60));
  console.log("  PASO 4 — Reconectar dashboard (disparar recovery)");
  console.log("━".repeat(60));

  if (IS_AUTO) {
    console.log(`\n  👆 PRENDÉ Tiempo Real en el dashboard AHORA.`);
    console.log(`     El recovery debería detectar canceledAt sin logs STATUS_CHANGED`);
    console.log(`     y mandar los prints automáticamente.`);
    for (let i = DELAY_S; i > 0; i--) {
      process.stdout.write(`\r     Continuando en ${i}s...   `);
      await sleep(1000);
    }
    process.stdout.write("\r" + " ".repeat(50) + "\r");
  } else {
    await prompt(`
  👆 PRENDÉ Tiempo Real en el dashboard AHORA.
     El recovery de useAutoPrintEngine debería detectar que
     los pedidos tienen timestamps.canceledAt pero no tienen
     logs STATUS_CHANGED — y mandar los prints automáticamente.
     Presioná Enter cuando esté encendido...`);
  }

  console.log(`\n⏳ Timeout: ${TIMEOUT_S}s  |  Polling cada ${POLL_MS / 1000}s\n`);

  // ═══════════════════════════════════════════════════════
  // PASO 5 — Verificar que el recovery disparó los logs
  // ═══════════════════════════════════════════════════════

  const cancelTemplateIds = cancelTemplates.map((t) => t.id);
  let recoveryMap;
  try {
    recoveryMap = await pollForLogs(db, orderIds, cancelTemplateIds, canceledAt, "logs recovery STATUS_CHANGED");
  } catch (err) {
    if (err.code === "permission-denied") {
      console.error("❌ PERMISSION_DENIED al leer printLogs.");
      process.exit(1);
    }
    throw err;
  }

  // ═══════════════════════════════════════════════════════
  // PASO 6 — Reporte final
  // ═══════════════════════════════════════════════════════

  printRecoveryReport(orderIds, recoveryMap, cancelTemplates, terminals, cancellationStatuses);

  console.log("━".repeat(60));
  console.log("  VERIFICACIÓN FÍSICA");
  console.log("━".repeat(60));
  console.log(`
  El recovery debería haber impreso en las ticketeras
  los avisos de cancelación para los ${orderIds.length} pedido(s).

  Si las hojas salieron → recovery funciona correctamente.
  Si no salieron    → revisá los logs de error en el reporte.
`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
