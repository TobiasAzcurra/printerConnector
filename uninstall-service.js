// uninstall-service.js
const { Service } = require("node-windows");
const path = require("path");

// IMPORTANTE: apuntamos de nuevo al mismo .exe
const exePath = path.join(__dirname, "dist", "server", "ticket-connector.exe");

const svc = new Service({
  name: "TicketConnectorService",
  script: exePath,
});

// Eventos
svc.on("uninstall", () => {
  console.log("✅ Servicio desinstalado correctamente.");
  console.log("Estado actual:", svc.exists ? "Instalado" : "No instalado");
});

svc.on("alreadyuninstalled", () => {
  console.log("⚠️ El servicio ya estaba desinstalado.");
});

svc.on("error", (err) => {
  console.error("❌ Error desinstalando servicio:", err.message);
});

// Ejecutamos la desinstalación
svc.uninstall();
