// scripts/seed-orders.js
// Crea pedidos de prueba en Firestore para testear las ticketeras.
//
// Uso:
//   node scripts/seed-orders.js            → crea 3 pedidos de prueba
//   node scripts/seed-orders.js --n 5      → crea 5 pedidos
//   node scripts/seed-orders.js --cleanup  → elimina los pedidos del último run

const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  collection,
  where,
  query,
  getDocs,
  addDoc,
  serverTimestamp,
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

const EMPRESA_ID  = "22d67ba8-6bb4-49f3-8d0a-6ad042617563";
const SUCURSAL_ID = "43f7ee6a-e716-4477-9a05-e6501774ae2e";

const LOG_FILE = path.join(__dirname, ".seed-orders-log.json");

const FAKE_PHONES = [
  "5493512000001",
  "5493512000002",
  "5493512000003",
  "5493512000004",
  "5493512000005",
];

const FAKE_ADDRESSES = [
  "Av. Colón 1234, Córdoba",
  "San Martín 567, Córdoba",
  "Bv. Chacabuco 890, Córdoba",
  "Deán Funes 321, Córdoba",
  "Obispo Trejo 45, Córdoba",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─── Log helpers  (formato: { runs: [{runAt, orders:[{id,createdAt}]}] }) ──────

function loadLog() {
  if (!fs.existsSync(LOG_FILE)) return { runs: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    // Migración de formato plano anterior → nuevo formato con runs
    if (Array.isArray(raw)) return { runs: raw.length > 0 ? [{ runAt: raw[0].createdAt, orders: raw }] : [] };
    return raw;
  } catch {
    return { runs: [] };
  }
}

function saveLog(data) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2), "utf8");
}

function loadLastRun(log) {
  if (!log.runs || log.runs.length === 0) return null;
  return log.runs[log.runs.length - 1];
}

// ─── Leer productos activos con stock infinito ────────────────────────────────

async function fetchProducts(db) {
  const q = query(
    collection(db, "absoluteClientes", EMPRESA_ID, "sucursales", SUCURSAL_ID, "productos"),
    where("active", "==", true),
    where("infiniteStock", "==", true)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No se encontraron productos activos con stock infinito.");
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Armar items del pedido ───────────────────────────────────────────────────

function buildOrderItems(products) {
  const count = Math.floor(Math.random() * 3) + 1; // 1 a 3 productos distintos
  const selected = [];

  for (let i = 0; i < count; i++) {
    const product       = pick(products);
    const defaultVariant = product.variants?.find((v) => v.default) || product.variants?.[0];
    const basePrice     = defaultVariant?.price || product.price || 0;
    const quantity      = Math.floor(Math.random() * 2) + 1; // 1 o 2 unidades

    selected.push({
      productId:   product.id,
      productName: product.name || "Producto",
      quantity,
      variantId:   defaultVariant?.id   || "default",
      variantName: defaultVariant?.name || "default",
      modifiers:   [],
      financeSummary: {
        unitBasePrice:      basePrice,
        unitVariantPrice:   0,
        unitModifiersPrice: 0,
        totalPrice:         round2(basePrice * quantity),
        unitCost:  0,
        totalCost: 0,
        unitMargin:  round2(basePrice),
        totalMargin: round2(basePrice * quantity),
      },
      stockSummary: {
        stockReference:   "",
        totalStockBefore: 0,
        totalStockAfter:  0,
        purchaseTrace:    [],
      },
    });
  }
  return selected;
}

// ─── Armar el documento del pedido ───────────────────────────────────────────

function buildOrderDoc(items) {
  const subtotal   = round2(items.reduce((s, i) => s + i.financeSummary.totalPrice, 0));
  const isDelivery = Math.random() > 0.4;
  const shipping   = isDelivery ? 2000 : 0;
  const total      = round2(subtotal + shipping);

  return {
    status:      "Pending",
    statusNote:  "",
    orderNotes:  "",
    _isTest:     true,
    from:        { feature: "webapp", employeeUser: "" },
    timestamps: {
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
      pendingAt:   serverTimestamp(),
      confirmedAt: null,
      readyAt:     null,
      deliveredAt: null,
      clientAt:    null,
      canceledAt:  null,
    },
    customer:    { phone: pick(FAKE_PHONES) },
    fulfillment: {
      method:        isDelivery ? "delivery" : "takeaway",
      assignedTo:    "",
      address:       isDelivery ? pick(FAKE_ADDRESSES) : "",
      coordinates:   isDelivery ? [-31.4167, -64.1834] : [0, 0],
      estimatedTime: null,
      deliveryNotes: "",
      distance:      null,
    },
    items,
    payment: {
      method: pick(["cash", "transfer", "card"]),
      status: "pending",
      financeSummary: {
        subtotal,
        shipping,
        totalDiscounts: 0,
        total,
        totalCosts: 0,
        GrossMargin: round2(subtotal),
        taxes:  "",
        finalProfitMarginPercentage: 1,
      },
      discounts: [],
    },
  };
}

// ─── Cleanup via REST API ─────────────────────────────────────────────────────

async function deleteViaRest(docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/absoluteClientes/${EMPRESA_ID}/sucursales/${SUCURSAL_ID}/pedidos/${docId}?key=${FIREBASE_CONFIG.apiKey}`;
  const res = await fetch(url, { method: "DELETE" });
  return res.ok || res.status === 404;
}

async function cleanup(log) {
  const lastRun = loadLastRun(log);

  if (!lastRun || lastRun.orders.length === 0) {
    console.log("✅ No hay runs registrados.");
    return log;
  }

  console.log(`🧹 Eliminando ${lastRun.orders.length} pedido(s) del último run (${lastRun.runAt})...\n`);

  const stillFailed = [];

  for (const entry of lastRun.orders) {
    const ok = await deleteViaRest(entry.id);
    if (ok) {
      console.log(`  🗑️  Eliminado: ${entry.id}`);
    } else {
      console.log(`  ⚠️  No se pudo eliminar: ${entry.id}`);
      stillFailed.push(entry);
    }
  }

  if (stillFailed.length === 0) {
    // Remover el último run del log
    log.runs.pop();
    console.log("\n✅ Run eliminado del log.");
  } else {
    lastRun.orders = stillFailed;
    console.log(`\n⚠️  ${stillFailed.length} pedido(s) requieren eliminación manual.`);
    console.log(`   Firebase console: https://console.firebase.google.com/project/${FIREBASE_CONFIG.projectId}/firestore`);
    for (const e of stillFailed) console.log(`   • ${e.id}`);
  }

  return log;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args      = process.argv.slice(2);
  const isCleanup = args.includes("--cleanup");
  const nFlag     = args.indexOf("--n");
  const count     = nFlag !== -1 ? parseInt(args[nFlag + 1]) || 3 : 3;

  let log = loadLog();

  if (isCleanup) {
    log = await cleanup(log);
    saveLog(log);
    process.exit(0);
  }

  const app = initializeApp(FIREBASE_CONFIG);
  const db  = getFirestore(app);

  console.log("📦 Leyendo productos activos con stock infinito...");
  const products = await fetchProducts(db);
  console.log(`  → ${products.length} producto(s): ${products.map((p) => p.name).join(", ")}\n`);

  const pedidosRef = collection(db, "absoluteClientes", EMPRESA_ID, "sucursales", SUCURSAL_ID, "pedidos");

  console.log(`🚀 Creando ${count} pedido(s) de prueba...\n`);

  const runAt  = new Date().toISOString();
  const runOrders = [];

  for (let i = 0; i < count; i++) {
    const items    = buildOrderItems(products);
    const orderDoc = buildOrderDoc(items);
    const ref      = await addDoc(pedidosRef, orderDoc);

    const itemsStr = items.map((it) => `${it.quantity}x ${it.productName}`).join(", ");
    const total    = orderDoc.payment.financeSummary.total;

    runOrders.push({ id: ref.id, createdAt: new Date().toISOString() });

    console.log(`  ✅ Pedido ${i + 1}/${count} creado`);
    console.log(`     ID      : ${ref.id}`);
    console.log(`     Items   : ${itemsStr}`);
    console.log(`     Total   : $${total}`);
    console.log(`     Método  : ${orderDoc.fulfillment.method}`);
    console.log(`     Teléfono: ${orderDoc.customer.phone}\n`);
  }

  log.runs.push({ runAt, orders: runOrders });
  saveLog(log);

  console.log(`✅ Run guardado. Para verificar: node scripts/verify-prints.js`);
  console.log(`   Para limpiar:   node scripts/seed-orders.js --cleanup`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
