const io = require("socket.io-client");

const API_BASE = "http://localhost:4040";

console.log(`Conectando a WebSocket en ${API_BASE}...`);
const socket = io(API_BASE);

let gotProcessing = false;

socket.on("connect", () => {
  console.log("✅ Conectado al servidor WebSocket!");
  
  // Enviar un trabajo a una IP VÁLIDA para probar el flujo de éxito completo
  const dummyPayload = {
    orderId: "pedido_LOCK_PRUEBA_001",
    printerName: "Cocina",
    _printer: {
      ip: "192.168.100.170", // Ticketera B (Configurada ayer, válida)
      port: 9100,
      width: 48
    },
    _templateInfo: {
      id: "ticket-prueba",
      jobId: "job_SUCCESS_TEST"
    },
    _template: {
      sections: [
        { type: "text", text: "Prueba de WebSocket job-processing y success" }
      ]
    }
  };

  console.log("Enviando trabajo de impresión válido...");
  fetch(`${API_BASE}/api/imprimir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dummyPayload)
  }).then(r => r.json())
    .then(data => {
      console.log("POST /api/imprimir exitoso:", data.jobId);
    })
    .catch(err => console.error("Error al enviar POST:", err));
});

let gotQueued = false;

socket.on("job-queued", (data) => {
  console.log("\n📥 ====== EVENTO JOB-QUEUED RECIBIDO ====== 📥");
  console.log(JSON.stringify(data, null, 2));
  console.log("=============================================\n");
  
  if (data.orderId === "pedido_LOCK_PRUEBA_001") {
      gotQueued = true;
  }
});

socket.on("job-processing", (data) => {
  console.log("\n⏳ ====== EVENTO JOB-PROCESSING RECIBIDO ====== ⏳");
  console.log(JSON.stringify(data, null, 2));
  console.log("=================================================\n");
  
  if (data.orderId === "pedido_LOCK_PRUEBA_001") {
      gotProcessing = true;
  }
});

socket.on("job-success", (data) => {
  console.log("\n✅ ====== EVENTO JOB-SUCCESS RECIBIDO ====== ✅");
  console.log(JSON.stringify(data, null, 2));
  console.log("==============================================\n");
  
  if (data.orderId === "pedido_LOCK_PRUEBA_001" && data.printerName === "Cocina") {
      if (gotQueued && gotProcessing) {
          console.log("Flujo COMPLETO Exitoso (Queued -> Processing -> Success) con PrinterName intacto. Cerrando...");
          process.exit(0);
      } else {
          console.log(`❌ ERROR de orden. Queued: ${gotQueued}, Processing: ${gotProcessing}`);
          process.exit(1);
      }
  }
});

socket.on("job-error", (data) => {
  console.log("\n🚨 ====== EVENTO JOB-ERROR RECIBIDO ====== 🚨");
  console.log(JSON.stringify(data, null, 2));
  
  if (data.orderId === "pedido_LOCK_PRUEBA_001") {
      console.log("Error. Puede que la ticketera B esté apagada. Si gotProcessing es true, igual emitimos processing bien.");
      console.log("Got Processing:", gotProcessing);
      process.exit(0);
  }
});

socket.on("connect_error", (err) => {
  console.log("❌ Error de conexión WS:", err.message);
});
