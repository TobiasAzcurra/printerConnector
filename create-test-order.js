// create-test-order.js
// Crea un pedido de prueba directamente en Firestore para testing del sistema de impresión.
// Uso: node create-test-order.js
//      node create-test-order.js --items 3       (pedido con 3 items distintos, qty 1 c/u)
//      node create-test-order.js --items 1 --qty 3  (pedido con 1 item, quantity 3)
//      node create-test-order.js --status Pending   (status inicial, default: Pending)

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

const PROJECT_ID    = "absolute-97d92";
const API_KEY       = config.apiKey;
const ENTERPRISE_ID = config.enterpriseId;
const SUCURSAL_ID   = config.sucursalId;

// ─── Argparse simple ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : defaultVal;
}

const ITEM_COUNT  = parseInt(getArg("items", "3"), 10);
const ITEM_QTY    = parseInt(getArg("qty",   "1"), 10);
const STATUS      = getArg("status", "Pending");

// ─── Converter a formato Firestore REST ──────────────────────────────────────

function toVal(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean")          return { booleanValue: val };
  if (typeof val === "string")           return { stringValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val))  return { arrayValue: { values: val.map(toVal) } };
  if (typeof val === "object") {
    return { mapValue: { fields: toFields(val) } };
  }
  return { stringValue: String(val) };
}

function toFields(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, toVal(v)])
  );
}

// ─── Catálogo de productos de prueba ─────────────────────────────────────────

const SAMPLE_ITEMS = [
  { productId: "test-prod-1", productName: "Burger de Prueba",  price: 1500 },
  { productId: "test-prod-2", productName: "Pizza de Prueba",   price: 2000 },
  { productId: "test-prod-3", productName: "Papas de Prueba",   price:  800 },
  { productId: "test-prod-4", productName: "Empanada de Prueba",price:  600 },
  { productId: "test-prod-5", productName: "Milanesa de Prueba",price: 1800 },
];

function buildItems(count, qty) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const sample = SAMPLE_ITEMS[i % SAMPLE_ITEMS.length];
    const totalPrice = sample.price * qty;
    items.push({
      productId:   sample.productId,
      productName: sample.productName,
      quantity:    qty,
      variantId:   "default",
      variantName: "Estándar",
      modifiers:   [],
      financeSummary: {
        unitBasePrice:      sample.price,
        unitVariantPrice:   0,
        unitModifiersPrice: 0,
        totalPrice,
        unitCost:    0,
        totalCost:   0,
        unitMargin:  sample.price,
        totalMargin: totalPrice,
      },
      stockSummary: {
        stockReference:   "",
        totalStockBefore: 0,
        totalStockAfter:  0,
        purchaseTrace:    [],
      },
    });
  }
  return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function createTestOrder() {
  const orderId = randomUUID();
  const now     = new Date();
  const items   = buildItems(ITEM_COUNT, ITEM_QTY);
  const subtotal = items.reduce((s, i) => s + i.financeSummary.totalPrice, 0);

  const pedido = {
    status:      STATUS,
    statusNote:  "",
    orderNotes:  `[TEST] ${ITEM_COUNT} item(s) x qty ${ITEM_QTY}`,
    from: { feature: "test_script", employeeUser: "" },
    timestamps: {
      createdAt:   now,
      updatedAt:   now,
      pendingAt:   STATUS === "Pending" ? now : null,
      confirmedAt: null,
      readyAt:     null,
      deliveredAt: null,
      clientAt:    null,
      canceledAt:  null,
    },
    customer:    { phone: "+5491100000000" },
    fulfillment: {
      method:        "takeaway",
      assignedTo:    "",
      address:       "",
      coordinates:   [0, 0],
      estimatedTime: null,
      deliveryNotes: "",
      distance:      null,
    },
    items,
    payment: {
      method: "cash",
      status: "pending",
      financeSummary: {
        subtotal,
        shipping:                    0,
        totalDiscounts:              0,
        total:                       subtotal,
        totalCosts:                  0,
        GrossMargin:                 subtotal,
        taxes:                       "",
        finalProfitMarginPercentage: 1,
      },
      discounts: [],
    },
  };

  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/` +
    `documents/absoluteClientes/${ENTERPRISE_ID}/sucursales/${SUCURSAL_ID}/pedidos` +
    `?documentId=${orderId}&key=${API_KEY}`;

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ fields: toFields(pedido) }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("❌ Error al crear pedido:");
    console.error(JSON.stringify(err, null, 2));
    process.exit(1);
  }

  console.log(`✅ Pedido creado exitosamente`);
  console.log(`   ID:      ${orderId}`);
  console.log(`   Status:  ${STATUS}`);
  console.log(`   Items:   ${ITEM_COUNT} producto(s) x cantidad ${ITEM_QTY}`);
  console.log(`   Total:   $${subtotal}`);
  console.log(`   Path:    absoluteClientes/${ENTERPRISE_ID}/sucursales/${SUCURSAL_ID}/pedidos/${orderId}`);
}

createTestOrder().catch((err) => {
  console.error("Error inesperado:", err.message);
  process.exit(1);
});
