const { Service } = require("node-windows");
const path = require("path");

// Ruta correcta al ticket-connector.exe dentro del dist/server
const exePath = path.join(__dirname, "dist", "server", "ticket-connector.exe");

const svc = new Service({
  name: "TicketConnectorService",
  description: "Conector de impresión automática para impresoras térmicas",
  script: exePath,
  wait: 2,
  grow: 0.5,
  maxRetries: 40,
  maxRestarts: 10,
});

// Eventos
svc.on("install", () => {
  console.log("✅ Servicio instalado correctamente.");
  svc.start();
});

svc.on("alreadyinstalled", () => {
  console.log("⚠️ El servicio ya estaba instalado.");
});

svc.on("start", () => {
  console.log("🚀 Servicio iniciado.");
});

svc.on("error", (err) => {
  console.error("❌ Error instalando servicio:", err);
});

// Instalar
svc.install();
