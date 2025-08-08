// auto-config.js - Sistema de auto-configuración inteligente
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
    return `${hostname}-${mac.substr(-6)}`;
  }

  // Obtener MAC address para ID único
  getMacAddress() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac !== "00:00:00:00:00:00") {
          return iface.mac.replace(/:/g, "");
        }
      }
    }
    return "unknown";
  }

  // Detectar rango de red automáticamente
  getNetworkRanges() {
    const interfaces = os.networkInterfaces();
    const ranges = new Set();

    for (const name in interfaces) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.family === "IPv4") {
          const ip = iface.address;
          const parts = ip.split(".");
          const baseRange = `${parts[0]}.${parts[1]}.${parts[2]}.`;
          ranges.add(baseRange);
        }
      }
    }

    // Agregar rangos comunes por si acaso
    ranges.add("192.168.1.");
    ranges.add("192.168.0.");
    ranges.add("192.168.100.");

    return Array.from(ranges);
  }

  // Buscar impresoras en la red
  async findPrinters() {
    console.log("🔍 Buscando impresoras térmicas...");
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

  // Verificar si una IP es una impresora
  async checkPrinter(ip) {
    try {
      // Primero ping
      const pingResult = await ping.promise.probe(ip, { timeout: 1 });
      if (!pingResult.alive) return null;

      // Luego verificar puerto 9100
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

  // Configuración automática completa
  async autoSetup() {
    console.log("🚀 Iniciando configuración automática...\n");

    console.log("📋 Información del sistema:");
    console.log(`   💻 Hostname: ${os.hostname()}`);
    console.log(`   🆔 Cliente ID: ${this.config.clienteId}`);
    console.log(`   🌐 Red detectada: ${this.getNetworkRanges().join(", ")}`);
    console.log("");

    // Buscar impresoras
    const printers = await this.findPrinters();

    if (printers.length > 0) {
      this.config.printerIP = printers[0]; // Usar la primera encontrada
      console.log(`🖨️ Impresora configurada: ${this.config.printerIP}`);
    } else {
      console.log(
        "⚠️ No se encontraron impresoras. Configuración manual requerida."
      );
      // Usar IP común por defecto
      const ranges = this.getNetworkRanges();
      this.config.printerIP = ranges[0] + "100";
    }

    // Guardar configuración
    this.saveConfig();

    console.log("\n✅ Configuración automática completada");
    console.log(`📄 Archivo de configuración guardado: config.json`);

    return this.config;
  }

  // Guardar configuración
  saveConfig() {
    fs.writeFileSync("config.json", JSON.stringify(this.config, null, 2));
  }

  // Validar configuración existente
  validateConfig() {
    if (!fs.existsSync("config.json")) {
      return false;
    }

    try {
      const existingConfig = JSON.parse(fs.readFileSync("config.json"));

      // Verificar campos requeridos
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

  // Test de conectividad con impresora
  async testPrinter(ip, port = 9100) {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(3000);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    });
  }

  // Reporte completo del sistema
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

    // Info de interfaces de red
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

    // Test de impresora si está configurada
    if (this.config.printerIP) {
      report.printerTest = await this.testPrinter(this.config.printerIP);
    }

    return report;
  }
}

// Uso directo del módulo
async function main() {
  const autoConfig = new AutoConfigurator();

  console.log("TicketConnector - Auto-Configurador v2.0\n");

  if (autoConfig.validateConfig()) {
    console.log("✅ Configuración existente encontrada");

    // Verificar si la impresora responde
    const existingConfig = JSON.parse(fs.readFileSync("config.json"));
    const printerWorks = await autoConfig.testPrinter(existingConfig.printerIP);

    if (printerWorks) {
      console.log("✅ Impresora actual responde correctamente");
      console.log("🚀 Sistema listo para usar");
    } else {
      console.log("⚠️ La impresora configurada no responde");
      console.log("🔄 Iniciando nueva búsqueda...");
      await autoConfig.autoSetup();
    }
  } else {
    console.log("⚙️ Primera configuración - iniciando auto-setup...");
    await autoConfig.autoSetup();
  }

  // Generar reporte del sistema
  const report = await autoConfig.generateSystemReport();
  fs.writeFileSync("system-report.json", JSON.stringify(report, null, 2));

  console.log("\n📊 Reporte del sistema guardado: system-report.json");
  console.log("🌐 Interfaz web: http://localhost:4040");
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = AutoConfigurator;
