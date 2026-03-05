const net = require('net');

function crearImpresoraVirtual(puerto, nombre) {
  const server = net.createServer((socket) => {
    console.log(`\n[${nombre}] 🖨️  ¡Conexión recibida en puerto ${puerto}!`);
    
    socket.on('data', (data) => {
      console.log(`[${nombre}] 📥 Recibiendo ticket... (${data.length} bytes)`);
      // Opcionalmente podrías descomentar esto para ver el raw de los comandos ESC/POS:
      // console.log(data.toString('ascii'));
    });

    socket.on('end', () => {
      console.log(`[${nombre}] 🔌 Ticket terminado. Conexión cerrada.`);
      console.log('-'.repeat(40));
    });
    
    socket.on('error', (err) => {
      console.error(`[${nombre}] ❌ Error en puerto ${puerto}:`, err.message);
    });
  });

  server.listen(puerto, '0.0.0.0', () => {
    console.log(`✅ Impresora virtual '${nombre}' lista y escuchando en puerto ${puerto}.`);
  });
}

console.log("Iniciando simulador de impresoras térmicas...\n");

// Levantamos 3 impresoras falsas
crearImpresoraVirtual(9101, "Caja");
crearImpresoraVirtual(9102, "Cocina");
crearImpresoraVirtual(9103, "Punto de Retiro");
