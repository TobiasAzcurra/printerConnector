// scripts/verify-prints.js
// Verifica que las ticketeras imprimieron correctamente los pedidos del último run.
//
// Uso:
//   node scripts/verify-prints.js               → solo ORDER_CREATED, timeout 60s
//   node scripts/verify-prints.js --timeout 90  → timeout personalizado
//   node scripts/verify-prints.js --full        → ciclo completo: ORDER_CREATED + cancelación

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
} = require("firebase/firestore");
const fs   = require("fs");
const path = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBrtAtARPV_Fp69XrJKdUzwoEvv1hXD0Uk",
  authDomain:        "absolute-97d92.firebaseapp.com",
  projectId:         "absolute-97d92",
  storageBucket:     "absolute-97d92.firebasestorage.app",
  messagingSenderId: "779319553398",
  appId:             "1:779319553398:web:ca47e54d0a9a7fd2f59e57",
};

const EMPRESA_ID       = "22d67ba8-6bb4-49f3-8d0a-6ad042617563";
const SUCURSAL_ID      = "43f7ee6a-e716-4477-9a05-e6501774ae2e";
const LOG_FILE         = path.join(__dirname, ".seed-orders-log.json");
const PRINT_FAILED_DIR = path.join(__dirname, "..", "print-failed");

// ─── Args ─────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const timeoutFlag = args.indexOf("--timeout");
const TIMEOUT_S   = timeoutFlag !== -1 ? parseInt(args[timeoutFlag + 1]) || 60 : 60;
const POLL_MS     = 3000;
const IS_FULL     = args.includes("--full");

// ─── Log ──────────────────────────────────────────────────────────────────────

function loadLastRun() {
  if (!fs.existsSync(LOG_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    if (!data.runs || data.runs.length === 0) return null;
    return data.runs[data.runs.length - 1];
  } catch {
    return null;
  }
}

// ─── Firebase: config de impresión ───────────────────────────────────────────

async function loadPrintConfig(db) {
  const cfgBase = ["absoluteClientes", EMPRESA_ID, "sucursales", SUCURSAL_ID, "config"];

  const [rulesSnap, tplSnap, termSnap] = await Promise.all([
    getDoc(doc(db, ...cfgBase, "printerRules")),
    getDocs(collection(db, ...cfgBase, "printer", "ticketTemplates")),
    getDocs(collection(db, ...cfgBase, "printer", "terminals")),
  ]);

  const rules     = rulesSnap.exists() ? (rulesSnap.data().rules || []) : [];
  const templates = tplSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const terminals = termSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return { rules, templates, terminals };
}

// ─── Firebase: pedidos ────────────────────────────────────────────────────────

async function loadOrders(db, orderIds) {
  const results = {};
  await Promise.all(
    orderIds.map(async (id) => {
      const snap = await getDoc(
        doc(db, "absoluteClientes", EMPRESA_ID, "sucursales", SUCURSAL_ID, "pedidos", id)
      );
      if (snap.exists()) results[id] = { id, ...snap.data() };
    })
  );
  return results;
}

// ─── Firebase: printLogs por pedido ──────────────────────────────────────────

async function fetchPrintLogs(db, orderId, since) {
  // Buffer de 5s para compensar posible clock skew entre máquina local y Firebase
  const sinceWithBuffer = new Date(since.getTime() - 5000);

  const logsRef = collection(
    db,
    "absoluteClientes", EMPRESA_ID,
    "sucursales",        SUCURSAL_ID,
    "pedidos",           orderId,
    "printLogs"
  );

  try {
    const q    = query(logsRef, where("timestamp", ">=", Timestamp.fromDate(sinceWithBuffer)));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  } catch (err) {
    // PERMISSION_DENIED: las reglas de Firestore no permiten lectura anónima de printLogs
    if (err.code === "permission-denied") throw err;
    return [];
  }
}

// ─── Cálculo de expected ──────────────────────────────────────────────────────

function buildExpectedMap(orderDetails, activeTemplates, terminals) {
  const map = {};

  for (const [orderId, order] of Object.entries(orderDetails)) {
    const totalUnits = (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0);
    const expected   = [];

    for (const tpl of activeTemplates) {
      const terminal = terminals.find((t) => (tpl.assignedTerminalIds || []).includes(t.id));
      expected.push({
        templateId:   tpl.id,
        templateName: tpl.name,
        terminalName: terminal?.name || "?",
        terminalIp:   terminal?.ip   || "?",
        printScope:   tpl.printScope,
        count:        tpl.printScope === "item" ? totalUnits : 1,
      });
    }

    map[orderId] = { order, expected };
  }

  return map;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntilComplete(db, expectedMap, seedRunAt) {
  const deadline  = Date.now() + TIMEOUT_S * 1000;
  const actualMap = {};

  for (const id of Object.keys(expectedMap)) actualMap[id] = {};

  while (true) {
    let allDone = true;

    for (const orderId of Object.keys(expectedMap)) {
      const logs = await fetchPrintLogs(db, orderId, seedRunAt);

      // Agrupar por templateId
      const byTemplate = {};
      for (const log of logs) {
        if (!byTemplate[log.templateId]) byTemplate[log.templateId] = [];
        byTemplate[log.templateId].push(log);
      }
      actualMap[orderId] = byTemplate;

      // Verificar si se completó el expected de este pedido
      for (const exp of expectedMap[orderId].expected) {
        if ((byTemplate[exp.templateId] || []).length < exp.count) {
          allDone = false;
        }
      }
    }

    if (allDone) {
      process.stdout.write("\r" + " ".repeat(60) + "\r");
      console.log("✅ Todos los logs detectados.\n");
      break;
    }

    if (Date.now() >= deadline) {
      process.stdout.write("\r" + " ".repeat(60) + "\r");
      console.log(`⏱️  Timeout (${TIMEOUT_S}s) alcanzado. Resultados parciales:\n`);
      break;
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write(`\r⏳ Esperando logs en Firestore... ${remaining}s restantes`);
    await sleep(POLL_MS);
  }

  return actualMap;
}

// ─── Cancelar pedidos via REST API ───────────────────────────────────────────

async function cancelOrderViaRest(orderId, status) {
  const docPath = `absoluteClientes/${EMPRESA_ID}/sucursales/${SUCURSAL_ID}/pedidos/${orderId}`;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=status&key=${FIREBASE_CONFIG.apiKey}`;
  try {
    const res = await fetch(url, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields: { status: { stringValue: status } } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function cancelOrders(orderIds) {
  const canceledAt = new Date();
  const statuses   = [];

  for (let i = 0; i < orderIds.length; i++) {
    const status = i % 2 === 0 ? "CanceledByCustomer" : "CanceledByEnterprise";
    const ok     = await cancelOrderViaRest(orderIds[i], status);
    statuses.push({ orderId: orderIds[i], status, ok });
    console.log(`   ${ok ? "✅" : "❌"}  ${orderIds[i].slice(0, 14)}...  → ${status}`);
  }

  return { canceledAt, statuses };
}

// ─── Cross-check con print-failed/ ───────────────────────────────────────────

function checkPrintFailed(orderIds) {
  const failedByOrder = {};
  if (!fs.existsSync(PRINT_FAILED_DIR)) return failedByOrder;

  const files = fs.readdirSync(PRINT_FAILED_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const data    = JSON.parse(fs.readFileSync(path.join(PRINT_FAILED_DIR, file), "utf8"));
      // El orderId puede estar en distintos lugares según la versión del payload
      const orderId = data.orderId
        || data._templateInfo?.orderId
        || data._templateInfo?.jobId?.split("-")[0]; // fallback

      if (orderId && orderIds.includes(orderId)) {
        if (!failedByOrder[orderId]) failedByOrder[orderId] = [];
        failedByOrder[orderId].push(file);
      }
    } catch {
      // Archivo corrupto o formato desconocido — ignorar
    }
  }

  return failedByOrder;
}

// ─── Validación de schema de logs ────────────────────────────────────────────
//
// Verifica que los documentos de printLog tienen los campos correctos.
// Esto detecta bugs en logPrintAttempt o en useAutoPrintEngine antes de que
// lleguen a producción silenciosamente.
//
// Para ORDER_CREATED: event debe ser "ORDER_CREATED" y statusTo NO debe existir.
// Para STATUS_CHANGED: event debe ser "STATUS_CHANGED" y statusTo DEBE existir
//   con el valor que corresponde al pedido cancelado.

function validateLogSchema(actualMap, phase, cancellationStatuses = {}) {
  const issues = [];

  for (const [orderId, byTemplate] of Object.entries(actualMap)) {
    for (const [templateId, logs] of Object.entries(byTemplate)) {
      for (const log of logs) {
        const prefix = `${orderId.slice(0, 12)} / tpl ${templateId.slice(0, 8)}`;

        // Campos comunes
        if (!log.templateId)   issues.push(`${prefix}: falta templateId`);
        if (!log.terminalName) issues.push(`${prefix}: falta terminalName`);
        if (!log.event)        issues.push(`${prefix}: falta campo event`);

        if (phase === "ORDER_CREATED") {
          if (log.event && log.event !== "ORDER_CREATED")
            issues.push(`${prefix}: event="${log.event}" (esperado "ORDER_CREATED")`);
          if (log.statusTo != null)
            issues.push(`${prefix}: tiene statusTo="${log.statusTo}" en log ORDER_CREATED (no debería existir)`);

        } else if (phase === "STATUS_CHANGED") {
          if (log.event && log.event !== "STATUS_CHANGED")
            issues.push(`${prefix}: event="${log.event}" (esperado "STATUS_CHANGED")`);
          if (!log.statusTo)
            issues.push(`${prefix}: falta statusTo — campo requerido para que el recovery funcione`);
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

function printSchemaReport(issues, phase) {
  if (issues.length === 0) {
    console.log(`✅ Schema de logs (${phase}): OK — todos los campos son correctos\n`);
  } else {
    console.log(`❌ Schema de logs (${phase}): ${issues.length} problema(s) detectado(s):`);
    issues.forEach((i) => console.log(`   • ${i}`));
    console.log();
  }
}

// ─── Reporte automatizado ─────────────────────────────────────────────────────

function printAutomatedReport(expectedMap, actualMap, failedJobsByOrder, label = "REPORTE AUTOMATIZADO") {
  const LINE = "═".repeat(60);
  console.log(LINE);
  console.log(`  ${label}`);
  console.log(LINE + "\n");

  const orderIds = Object.keys(expectedMap);
  let passCount  = 0;

  for (const orderId of orderIds) {
    const { order, expected } = expectedMap[orderId];
    const items  = (order.items || []).map((i) => `${i.quantity}x ${i.productName}`).join(", ");
    const total  = order.payment?.financeSummary?.total || 0;
    const method = order.fulfillment?.method || "?";

    console.log(`📦  ${orderId.slice(0, 14)}...`);
    console.log(`    Items   : ${items}`);
    console.log(`    Total   : $${total}  (${method})`);

    const actual     = actualMap[orderId] || {};
    const failedJobs = failedJobsByOrder[orderId] || [];
    let   orderOk    = true;

    for (const exp of expected) {
      const logs      = actual[exp.templateId] || [];
      const count     = logs.length;
      const hasError  = logs.some((l) => l.status === "error");
      const connFail  = failedJobs.length > 0;
      const scopeNote = exp.printScope === "item"
        ? `(${exp.count} unidad${exp.count !== 1 ? "es" : ""})`
        : "(orden completa)";

      let icon, note;

      if (count === 0) {
        icon = "❌"; note = `0/${exp.count} — sin logs`;
        orderOk = false;
      } else if (hasError) {
        icon = "❌"; note = `${count}/${exp.count} — error al enviar al conector`;
        orderOk = false;
      } else if (count < exp.count) {
        icon = "❌"; note = `${count}/${exp.count} — logs incompletos`;
        orderOk = false;
      } else if (count > exp.count) {
        icon = "⚠️ "; note = `${count}/${exp.count} — más logs de lo esperado (posible duplicado)`;
        orderOk = false;
      } else if (connFail) {
        icon = "⚠️ "; note = `${count}/${exp.count} enviados pero conector falló (ver print-failed/)`;
        orderOk = false;
      } else {
        icon = "✅"; note = `${count}/${exp.count}`;
      }

      console.log(`    ${icon}  ${exp.templateName.padEnd(34)} → ${exp.terminalName.padEnd(12)} ${note} ${scopeNote}`);
    }

    if (failedJobs.length > 0) {
      console.log(`    ⚠️   Jobs en print-failed/: ${failedJobs.join(", ")}`);
    }

    if (orderOk) passCount++;
    console.log();
  }

  const emoji = passCount === orderIds.length ? "✅" : passCount === 0 ? "❌" : "⚠️ ";
  console.log(`${emoji}  RESULTADO AUTOMÁTICO: ${passCount}/${orderIds.length} pedidos ok\n`);
}

// ─── Guía de verificación física ─────────────────────────────────────────────

function printManualVerification(orderDetails, activeTemplates, terminals, label = "VERIFICACIÓN FÍSICA — revisá estas hojas") {
  const LINE = "═".repeat(60);
  console.log(LINE);
  console.log(`  ${label}`);
  console.log(LINE);

  for (const tpl of activeTemplates) {
    const terminal = terminals.find((t) => (tpl.assignedTerminalIds || []).includes(t.id));
    const termName = (terminal?.name || "?").toUpperCase();
    const termIp   = terminal?.ip || "?";

    console.log(`\n🖨️   ${termName} (${termIp}) — "${tpl.name}":`);

    const orders = Object.values(orderDetails);

    if (tpl.printScope === "order") {
      console.log(`     ${orders.length} hoja${orders.length !== 1 ? "s" : ""}:`);
      for (const order of orders) {
        const items  = (order.items || []).map((i) => `${i.quantity}x ${i.productName}`).join(", ");
        const method = order.fulfillment?.method || "?";
        const total  = order.payment?.financeSummary?.total || 0;
        console.log(`     • ${method.padEnd(9)} $${String(total).padStart(7)}  →  ${items}`);
      }
    } else {
      // item-scope: una hoja por unidad de cada ítem
      let totalSheets = 0;
      const lines     = [];

      for (const order of orders) {
        for (const item of (order.items || [])) {
          const qty = item.quantity || 1;
          totalSheets += qty;
          lines.push(`     • ${item.productName}  ×${qty}  (${qty} hoja${qty !== 1 ? "s" : ""})`);
        }
      }

      console.log(`     ${totalSheets} hoja${totalSheets !== 1 ? "s" : ""} en total:`);
      lines.forEach((l) => console.log(l));
    }
  }

  console.log();
}

// ─── Helpers de reporte ───────────────────────────────────────────────────────

function showExpected(expectedMap) {
  for (const [orderId, { order, expected }] of Object.entries(expectedMap)) {
    const items = (order.items || []).map((i) => `${i.quantity}x ${i.productName}`).join(", ");
    console.log(`   ${orderId.slice(0, 12)}...  [${items}]`);
    for (const exp of expected) {
      console.log(`     → ${exp.templateName} ×${exp.count}  (${exp.terminalName})`);
    }
  }
}

async function runPolling(db, expectedMap, since) {
  let actualMap;
  try {
    actualMap = await pollUntilComplete(db, expectedMap, since);
  } catch (err) {
    if (err.code === "permission-denied") {
      console.error("\n❌ PERMISSION_DENIED al leer printLogs.");
      console.error("   Las reglas de Firestore no permiten lectura anónima de printLogs.");
      console.error("   Solución: ajustá las reglas de Firestore para desarrollo o usá un service account.\n");
      process.exit(1);
    }
    throw err;
  }
  return actualMap;
}

function countSentLogs(actualMap) {
  let total = 0;
  for (const byTemplate of Object.values(actualMap)) {
    for (const logs of Object.values(byTemplate)) {
      total += logs.filter((l) => l.status === "sent").length;
    }
  }
  return total;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Cargar último run
  const lastRun = loadLastRun();
  if (!lastRun || lastRun.orders.length === 0) {
    console.error("❌ No hay runs registrados. Ejecutá seed-orders.js primero.");
    process.exit(1);
  }

  const seedRunAt = new Date(lastRun.runAt);
  const orderIds  = lastRun.orders.map((o) => o.id);

  console.log(`📋 Último run: ${lastRun.runAt}`);
  console.log(`   ${orderIds.length} pedido(s): ${orderIds.map((id) => id.slice(0, 8) + "...").join(", ")}`);
  if (IS_FULL) console.log("   Modo: COMPLETO (ORDER_CREATED + cancelación)");
  console.log();

  // 2. Firebase
  const app = initializeApp(FIREBASE_CONFIG);
  const db  = getFirestore(app);

  // 3. Config de impresión
  console.log("🔧 Cargando configuración de impresión...");
  const { rules, templates, terminals } = await loadPrintConfig(db);

  // ── Regla ORDER_CREATED ──
  const orderCreatedRule = rules.find((r) => r.isEnabled && r.event === "ORDER_CREATED");
  if (!orderCreatedRule) {
    console.error("❌ No hay regla ORDER_CREATED activa.");
    process.exit(1);
  }
  const createdTemplates = orderCreatedRule.templateIds
    .map((id) => templates.find((t) => t.id === id && t.isEnabled))
    .filter(Boolean);
  if (createdTemplates.length === 0) {
    console.error("❌ Los templates de la regla ORDER_CREATED no están habilitados o no existen.");
    process.exit(1);
  }

  // ── Regla de cancelación (solo si --full) ──
  let cancelRule     = null;
  let cancelTemplates = [];
  if (IS_FULL) {
    cancelRule = rules.find(
      (r) => r.isEnabled && r.event === "STATUS_CHANGED" &&
             r.conditions?.statusTo?.some((s) => s.startsWith("Canceled"))
    );
    if (!cancelRule) {
      console.error("❌ No hay regla STATUS_CHANGED de cancelación activa. Revisá la configuración.");
      process.exit(1);
    }
    cancelTemplates = cancelRule.templateIds
      .map((id) => templates.find((t) => t.id === id && t.isEnabled))
      .filter(Boolean);
    if (cancelTemplates.length === 0) {
      console.error("❌ Los templates de la regla de cancelación no están habilitados o no existen.");
      process.exit(1);
    }
  }

  console.log(`   ORDER_CREATED : "${orderCreatedRule.name}" (${createdTemplates.map((t) => t.name).join(", ")})`);
  if (IS_FULL) {
    console.log(`   Cancelación   : "${cancelRule.name}" (${cancelTemplates.map((t) => t.name).join(", ")})`);
  }
  console.log();

  // 4. Cargar pedidos
  console.log("📦 Cargando pedidos desde Firestore...");
  const orderDetails = await loadOrders(db, orderIds);
  const missing = orderIds.filter((id) => !orderDetails[id]);
  if (missing.length > 0) console.warn(`   ⚠️  No encontrados: ${missing.join(", ")}`);
  console.log(`   ${Object.keys(orderDetails).length}/${orderIds.length} pedidos cargados\n`);

  // ═══════════════════════════════════════════════════════
  // FASE 1 — ORDER_CREATED
  // ═══════════════════════════════════════════════════════

  console.log("━".repeat(60));
  console.log("  FASE 1 — ORDER_CREATED");
  console.log("━".repeat(60) + "\n");

  const expectedMapP1 = buildExpectedMap(orderDetails, createdTemplates, terminals);
  console.log("🎯 Esperado por pedido:\n");
  showExpected(expectedMapP1);
  console.log(`\n⏱️  Timeout: ${TIMEOUT_S}s  |  Polling cada ${POLL_MS / 1000}s\n`);

  const actualMapP1      = await runPolling(db, expectedMapP1, seedRunAt);
  const failedJobsByOrder = checkPrintFailed(orderIds);

  printAutomatedReport(expectedMapP1, actualMapP1, failedJobsByOrder, "FASE 1 — ORDER_CREATED");
  printSchemaReport(validateLogSchema(actualMapP1, "ORDER_CREATED"), "Fase 1");

  if (!IS_FULL) {
    printManualVerification(orderDetails, createdTemplates, terminals, "VERIFICACIÓN FÍSICA — ORDER_CREATED");
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════
  // FASE 2 — CANCELACIÓN
  // ═══════════════════════════════════════════════════════

  // Guard: si el motor no procesó ningún ORDER_CREATED, no va a detectar el STATUS_CHANGED
  const sentInP1 = countSentLogs(actualMapP1);
  if (sentInP1 === 0) {
    console.error("━".repeat(60));
    console.error("  FASE 2 — ABORTADA");
    console.error("━".repeat(60));
    console.error("\n⚠️  La Fase 1 no registró ningún log 'sent'.");
    console.error("   El motor de impresión no procesó los ORDER_CREATED,");
    console.error("   por lo que los pedidos no están en previousPedidosRef.");
    console.error("   Un STATUS_CHANGED no dispararía nada.\n");
    console.error("   Verificá que:");
    console.error("   1. El dashboard está abierto con isPrimaryPrintStation=true");
    console.error("   2. El modo Tiempo Real está activo\n");
    process.exit(1);
  }

  console.log("━".repeat(60));
  console.log("  FASE 2 — CANCELACIÓN");
  console.log("━".repeat(60) + "\n");

  console.log("🚫 Cancelando pedidos en Firestore...\n");
  const { canceledAt, statuses } = await cancelOrders(orderIds);

  const failedCancels = statuses.filter((s) => !s.ok);
  if (failedCancels.length > 0) {
    console.warn(`\n⚠️  ${failedCancels.length} pedido(s) no se pudieron cancelar (PERMISSION_DENIED?):`);
    failedCancels.forEach((s) => console.warn(`   • ${s.orderId}`));
    console.warn("   La Fase 2 puede arrojar resultados incompletos.\n");
  } else {
    console.log("\n   Todos los pedidos cancelados correctamente.\n");
  }

  const expectedMapP2 = buildExpectedMap(orderDetails, cancelTemplates, terminals);
  console.log("🎯 Esperado por pedido (cancelación):\n");
  showExpected(expectedMapP2);
  console.log(`\n⏱️  Timeout: ${TIMEOUT_S}s  |  Polling cada ${POLL_MS / 1000}s\n`);

  const actualMapP2 = await runPolling(db, expectedMapP2, canceledAt);

  const cancellationStatuses = {};
  statuses.forEach((s) => { if (s.ok) cancellationStatuses[s.orderId] = s.status; });

  printAutomatedReport(expectedMapP2, actualMapP2, failedJobsByOrder, "FASE 2 — CANCELACIÓN");

  // Filtrar actualMapP2 a solo los templateIds del cancelRule antes de validar schema.
  // El buffer de 5s en fetchPrintLogs puede traer logs ORDER_CREATED del seed original,
  // lo que causaría falsos positivos al validar que event === "STATUS_CHANGED".
  const cancelTemplateIdSet = new Set(cancelTemplates.map((t) => t.id));
  const filteredActualMapP2 = {};
  for (const [orderId, byTemplate] of Object.entries(actualMapP2)) {
    filteredActualMapP2[orderId] = {};
    for (const [tplId, logs] of Object.entries(byTemplate)) {
      if (cancelTemplateIdSet.has(tplId)) filteredActualMapP2[orderId][tplId] = logs;
    }
  }
  printSchemaReport(validateLogSchema(filteredActualMapP2, "STATUS_CHANGED", cancellationStatuses), "Fase 2");

  // ─── Guía física combinada ────────────────────────────────────────────────
  printManualVerification(orderDetails, createdTemplates, terminals, "VERIFICACIÓN FÍSICA — ORDER_CREATED (Fase 1)");
  printManualVerification(orderDetails, cancelTemplates, terminals,  "VERIFICACIÓN FÍSICA — CANCELACIÓN (Fase 2)");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
