const ping = require("ping");

const baseIP = "192.168.0."; // Cambiá esto si usás otra red
const start = 1;
const end = 254;

console.log("🔎 Escaneando red local...\n");

(async () => {
  const promises = [];

  for (let i = start; i <= end; i++) {
    const ip = baseIP + i;
    promises.push(
      ping.promise
        .probe(ip, {
          timeout: 1,
          extra: ["-n", "1"],
        })
        .then((res) => {
          if (res.alive) {
            console.log(`✅ ${res.host} está activo`);
          }
        })
    );
  }

  await Promise.all(promises);
  console.log("\n✅ Escaneo completado.");
})();
