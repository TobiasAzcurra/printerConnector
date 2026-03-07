const io = require("socket.io-client");
const { v4: uuidv4 } = require("uuid");

const API_BASE = "http://localhost:4040";

const TEST_LOG_ID = uuidv4();
console.log(`logId de prueba: ${TEST_LOG_ID}`);

console.log(`Conectando a WebSocket en ${API_BASE}...`);
const socket = io(API_BASE);

socket.on("connect", () => {
  console.log("✅ Conectado al servidor WebSocket!");

  // Enviar un trabajo a una IP falsa para provocar un fallo y timeout
  const dummyPayload = {
    orderId: "pedido_PRUEBA_WS_123",
    _printer: {
      ip: "10.255.255.255", // IP falsa que no responderá
      port: 9100,
      width: 48
    },
    _templateInfo: {
      id: "ticket-prueba",
      jobId: "job_WS_ERROR_TEST",
      logId: TEST_LOG_ID,
    },
    _template: {
      sections: [
        { type: "text", text: "Ticket de prueba" }
      ]
    }
  };

  console.log("Enviando trabajo de impresión destinado a fallar por timeout...");
  fetch(`${API_BASE}/api/imprimir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dummyPayload)
  }).then(r => r.json())
    .then(data => {
      console.log("POST /api/imprimir exitoso:", data);
      console.log("⏳ Esperando que pasen los reintentos (esto tardará unos 3 minutos dependiendo del backoff)...");
    })
    .catch(err => console.error("Error al enviar POST:", err));
});

socket.on("job-processing", (data) => {
  console.log(`\n⏳ ====== EVENTO JOB-PROCESSING (Intento ${data.attempt || 1}) ====== ⏳`);
  console.log(JSON.stringify(data, null, 2));
  console.log("=====================================================\n");
});

socket.on("job-error", (data) => {
  console.log("\n🚨 ====== EVENTO JOB-ERROR RECIBIDO ====== 🚨");
  console.log(JSON.stringify(data, null, 2));
  console.log("========================================\n");

  if (data.orderId === "pedido_PRUEBA_WS_123") {
    if (data.logId === TEST_LOG_ID) {
      console.log("✅ logId verificado correctamente en job-error. Prueba exitosa. Cerrando...");
      process.exit(0);
    } else {
      console.error(`❌ logId incorrecto. Esperado: ${TEST_LOG_ID} | Recibido: ${data.logId}`);
      process.exit(1);
    }
  }
});

socket.on("connect_error", (err) => {
  console.log("❌ Error de conexión WS:", err.message);
});
