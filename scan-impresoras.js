const ping = require("ping");
const net = require("net");

const baseIP = "192.168.100."; // Cambiá si tu red es otra
const puerto = 9100;
const start = 1;
const end = 254;

console.log("🔎 Buscando impresoras en la red (puerto 9100)...\n");

async function verificarPuerto(ip, port, timeout = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let conectado = false;

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      conectado = true;
      socket.destroy();
    });

    socket.on("timeout", () => {
      socket.destroy();
    });

    socket.on("error", () => {
      socket.destroy();
    });

    socket.on("close", () => {
      resolve(conectado);
    });

    socket.connect(port, ip);
  });
}

(async () => {
  const checks = [];

  for (let i = start; i <= end; i++) {
    const ip = baseIP + i;

    checks.push(
      ping.promise.probe(ip, { timeout: 1 }).then(async (res) => {
        if (res.alive) {
          const tienePuerto = await verificarPuerto(ip, puerto);
          if (tienePuerto) {
            console.log(
              `🖨️ ${ip} responde en el puerto ${puerto} (posible impresora)`
            );
          } else {
            console.log(
              `❌ ${ip} activo pero no responde en el puerto ${puerto}`
            );
          }
        }
      })
    );
  }

  await Promise.all(checks);
  console.log("\n✅ Escaneo de impresoras completado.");
})();
