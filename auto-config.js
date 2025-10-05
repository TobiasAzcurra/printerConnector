// auto-config.js - Sistema de auto-configuración (versión forzada a IP fija)
// Esta versión evita el escaneo completo de la red y usa por defecto
// la IP 192.168.100.169 (si no hay config.json con otra IP).
// Guardá este archivo sustituyendo el anterior y ejecutá `node auto-config.js`.

const os = require("os");
const fs = require("fs");
const ping = require("ping");
const net = require("net");

class AutoConfigurator {
  constructor() {
    this.config = {
      clienteId: this.generateClientId(),
      printerIP: null,
      printerPort: 9100,
      businessName: "Mi Negocio",
      ticketWidth: 48,
      useHeaderLogo: true,
      useFooterLogo: true,
      useFontTicket: false,
    };
  }

  // Generar ID único basado en la máquina
  generateClientId() {
    const hostname = os
      .hostname()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const mac = this.getMacAddress();
    return `${hostname}-${String(mac).substr(-6) || "unknown"}`;
  }

  // Obtener MAC address para ID único
  getMacAddress() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
          return iface.mac.replace(/:/g, "");
        }
      }
    }
    return "unknown";
  }

  // Detectar rango de red automáticamente (no se usa en la versión forzada,
  // pero se mantiene por compatibilidad si querés volver al escaneo)
  getNetworkRanges() {
    const interfaces = os.networkInterfaces();
    const ranges = new Set();

    for (const name in interfaces) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.family === "IPv4") {
          const ip = iface.address;
          const parts = ip.split(".");
          if (parts.length === 4) {
            const baseRange = `${parts[0]}.${parts[1]}.${parts[2]}.`;
            ranges.add(baseRange);
          }
        }
      }
    }

    // Rangos comunes
    ranges.add("192.168.1.");
    ranges.add("192.168.0.");
    ranges.add("192.168.100.");

    return Array.from(ranges);
  }

  // (No se usa en autoSetup forzado) Buscar impresoras en la red
  async findPrinters() {
    console.log(
      "🔍 Buscando impresoras térmicas (este método puede llevar tiempo)..."
    );
    const ranges = this.getNetworkRanges();
    const printers = [];

    for (const range of ranges) {
      console.log(`   Escaneando ${range}x...`);
      const promises = [];
      for (let i = 1; i <= 254; i++) {
        const ip = range + i;
        promises.push(this.checkPrinter(ip));
      }
      const results = await Promise.allSettled(promises);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          printers.push(result.value);
          console.log(`✅ Impresora encontrada: ${result.value}`);
        }
      }
    }

    return printers;
  }

  // Verificar si una IP es una impresora (ping + puerto 9100)
  async checkPrinter(ip) {
    try {
      const pingResult = await ping.promise.probe(ip, { timeout: 1 });
      if (!pingResult.alive) return null;

      return new Promise((resolve) => {
        const socket = new net.Socket();
        let isConnected = false;

        socket.setTimeout(800);

        socket.on("connect", () => {
          isConnected = true;
          socket.destroy();
          resolve(ip);
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve(null);
        });

        socket.on("error", () => {
          socket.destroy();
          resolve(null);
        });

        socket.connect(9100, ip);
      });
    } catch (error) {
      return null;
    }
  }

  // --- NUEVAS FUNCIONES: carga rápida de config existente y autoSetup forzado ---

  // Cargar config.json si existe y fusionarla con this.config
  loadExistingConfig() {
    try {
      if (fs.existsSync("config.json")) {
        const raw = fs.readFileSync("config.json", "utf8");
        const parsed = JSON.parse(raw);
        this.config = { ...this.config, ...parsed };
        // Asegurar campos obligatorios con defaults
        if (!this.config.printerPort) this.config.printerPort = 9100;
        if (!this.config.ticketWidth) this.config.ticketWidth = 48;
      }
    } catch (err) {
      console.warn(
        "⚠️ No se pudo leer config.json (se usará configuración por defecto)."
      );
    }
  }

  // Configuración automática forzada: usa la IP del config.json o la fija 192.168.100.169
  async autoSetup() {
    console.log(
      "🚀 Iniciando configuración automática (modo rápido/fijar IP) ...\n"
    );

    // Cargar config existente si hay
    this.loadExistingConfig();

    // Si no hay printerIP en config.json, usar IP por defecto (forzada)
    if (!this.config.printerIP) {
      console.log(
        "⚠️ No se encontró printerIP en config.json. Se fijará 192.168.100.169 por defecto."
      );
      this.config.printerIP = "192.168.100.169";
    } else {
      console.log(
        `ℹ️ Usando printerIP desde config.json: ${this.config.printerIP}`
      );
    }

    // Asegurar puerto
    if (!this.config.printerPort) this.config.printerPort = 9100;

    // Guardar config inmediatamente (para que other components lean la misma)
    this.saveConfig();

    // Test rápido de conectividad TCP al puerto configurado
    const ip = this.config.printerIP;
    const port = this.config.printerPort;
    console.log(`🔍 Probando conexión TCP a ${ip}:${port} ...`);

    const ok = await this.testPrinter(ip, port);

    if (ok) {
      console.log(`✅ Impresora responde en ${ip}:${port}`);
    } else {
      console.log(`⚠️ No responde ${ip}:${port}. Verificá:`);
      console.log("   - Que la impresora esté encendida");
      console.log("   - Que el cable Ethernet esté conectado correctamente");
      console.log("   - Que la impresora y la PC estén en la misma red/subred");
      console.log("   - Que no haya firewalls bloqueando el puerto 9100");
      console.log("   - Que la IP configurada en la impresora sea la correcta");
    }

    console.log(
      "\n✅ Auto-setup (modo rápido) finalizado. Configuración guardada en config.json"
    );
    return this.config;
  }

  // Guardar configuración en config.json
  saveConfig() {
    try {
      fs.writeFileSync("config.json", JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("❌ Error guardando config.json:", err.message);
    }
  }

  // Valida si config.json existe y tiene campos mínimos
  validateConfig() {
    if (!fs.existsSync("config.json")) return false;
    try {
      const existingConfig = JSON.parse(fs.readFileSync("config.json", "utf8"));
      const required = [
        "clienteId",
        "printerIP",
        "printerPort",
        "businessName",
      ];
      return required.every((field) => existingConfig.hasOwnProperty(field));
    } catch {
      return false;
    }
  }

  // Test de conectividad con impresora (TCP). Timeout reducido para rapidez.
  async testPrinter(ip, port = 9100) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let finished = false;

      socket.setTimeout(1500); // timeout 1.5s (ajustable)

      socket.once("connect", () => {
        finished = true;
        socket.destroy();
        resolve(true);
      });

      socket.once("timeout", () => {
        if (!finished) {
          finished = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.once("error", () => {
        if (!finished) {
          finished = true;
          socket.destroy();
          resolve(false);
        }
      });

      try {
        socket.connect(port, ip);
      } catch (err) {
        if (!finished) {
          finished = true;
          try {
            socket.destroy();
          } catch {}
          resolve(false);
        }
      }
    });
  }

  // Generar un reporte del sistema (útil para debugging)
  async generateSystemReport() {
    const report = {
      timestamp: new Date().toISOString(),
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        memory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + " GB",
      },
      network: {
        interfaces: {},
        detectedRanges: this.getNetworkRanges(),
      },
      config: this.config,
      printerTest: null,
    };

    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      report.network.interfaces[name] = interfaces[name]
        .filter((iface) => !iface.internal)
        .map((iface) => ({
          address: iface.address,
          family: iface.family,
          mac: iface.mac,
        }));
    }

    if (this.config.printerIP) {
      report.printerTest = await this.testPrinter(
        this.config.printerIP,
        this.config.printerPort
      );
    }

    return report;
  }
}

// Si el archivo se ejecuta directamente, correr el auto-setup rápido
async function main() {
  const autoConfig = new AutoConfigurator();

  console.log("TicketConnector - Auto-Configurador (modo rápido) v2.0\n");

  // Si ya hay config válida, solo probarla; si no, crear/usar IP fija
  if (autoConfig.validateConfig()) {
    console.log("✅ Configuración existente encontrada en config.json");
    const existingConfig = JSON.parse(fs.readFileSync("config.json", "utf8"));
    const printerWorks = await autoConfig.testPrinter(
      existingConfig.printerIP,
      existingConfig.printerPort
    );
    if (printerWorks) {
      console.log(
        `✅ Impresora actual (${existingConfig.printerIP}:${existingConfig.printerPort}) responde correctamente`
      );
    } else {
      console.log(
        "⚠️ La impresora configurada no responde. Se ejecutará auto-setup rápido para forzar IP por defecto."
      );
      await autoConfig.autoSetup();
    }
  } else {
    console.log("⚙️ No hay config válida. Ejecutando auto-setup rápido...");
    await autoConfig.autoSetup();
  }

  // Generar y guardar reporte del sistema para debugging
  try {
    const report = await autoConfig.generateSystemReport();
    fs.writeFileSync("system-report.json", JSON.stringify(report, null, 2));
    console.log("\n📊 Reporte del sistema guardado: system-report.json");
  } catch (err) {
    console.warn("⚠️ No se pudo generar system-report.json:", err.message);
  }

  console.log("🌐 Interfaz web (si aplica): http://localhost:4040");
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Error en auto-config:", err);
    process.exit(1);
  });
}

module.exports = AutoConfigurator;
