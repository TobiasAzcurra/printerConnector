// web/server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors"); // Para manejar solicitudes cross-origin
const multer = require("multer"); // Para manejar upload de archivos
const sharp = require("sharp"); // Para procesar imágenes
const net = require("net"); // Para ping de puerto 9100
const crypto = require("crypto"); // Para hashing de assets
const fontRenderer = require("../src/font-renderer");
const fontCache = require("../src/font-renderer/cache");
const textRenderer = require("../src/font-renderer/text-renderer");
const templateSystem = require("../src/templates");

const app = express();
const PORT = 4040;

// Rutas a archivos y directorios importantes
const ROOT_DIR = path.join(__dirname, "..");
const configPath = path.join(ROOT_DIR, "config.json");
const assetsDir = path.join(ROOT_DIR, "assets");
const fontsDir = path.join(assetsDir, "fonts"); // Directorio para fuentes
const tempPrintJobPath = path.join(ROOT_DIR, "temp-print-job.json");

// --- Compat retro (archivos legacy) ---
const legacyHeaderPath = path.join(assetsDir, "logo-header.png");
const legacyFooterPath = path.join(assetsDir, "logo-footer.png");

// Configuración de multer para subir archivos
const storage = multer.memoryStorage(); // Almacenar archivo en memoria temporalmente

// Función de filtro que acepta tanto imágenes como archivos .ttf
const fileFilter = function (req, file, cb) {
  // Para rutas de carga de fuentes, permitir archivos .ttf
  if (req.path.includes("/upload-font")) {
    if (!file.originalname.toLowerCase().endsWith(".ttf")) {
      return cb(new Error("Solo se permiten archivos TTF"), false);
    }
    return cb(null, true);
  }
  // Para otras rutas (logos), permitir solo imágenes
  else {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten archivos de imagen"), false);
    }
    return cb(null, true);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
  fileFilter: fileFilter,
});

// Middleware
app.use(express.json());
app.use(cors()); // Habilitar CORS para todas las rutas
app.use(express.static(path.join(__dirname, "public")));

// Crear directorios necesarios si no existen
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
  console.log("📁 Carpeta de assets creada");
}

// Crear directorio de fuentes si no existe
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
  console.log("📁 Carpeta de fuentes creada");
}

// Utilidad: leer config con defaults
function readConfigSafe() {
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      clienteId: "cliente-default",
      printerIP: "",
      printerPort: 9100,
      businessName: "Mi Negocio",
      ticketWidth: 48,
      useHeaderLogo: true,
      useFooterLogo: true,
      useFontTicket: false,
      assets: {},
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // Asegurar que los campos nuevos existan (para retrocompatibilidad)
  if (config.useHeaderLogo === undefined) config.useHeaderLogo = true;
  if (config.useFooterLogo === undefined) config.useFooterLogo = true;
  if (config.ticketWidth === undefined) config.ticketWidth = 48;
  if (config.useFontTicket === undefined) config.useFontTicket = false;
  if (!config.printerPort) config.printerPort = 9100;
  if (!config.businessName) config.businessName = "Mi Negocio";
  if (!config.assets) config.assets = {};

  // Retrocompatibilidad con configuración anterior
  if (config.useLogo !== undefined && config.useHeaderLogo === undefined) {
    config.useHeaderLogo = config.useLogo;
  }

  return config;
}

/**
 * Resuelve paths de logos priorizando los guardados en config.assets.* (por cliente),
 * con fallback a los archivos legacy en assets/logo-*.png.
 */
function resolveLogoPathsFromConfig() {
  const cfg = readConfigSafe();
  const clienteId = (cfg.clienteId || "cliente-default").toString();

  const cfgHeader = cfg.assets?.logoHeader?.path
    ? path.join(ROOT_DIR, cfg.assets.logoHeader.path)
    : path.join(assetsDir, "logos", clienteId, "header.png");

  const cfgFooter = cfg.assets?.logoFooter?.path
    ? path.join(ROOT_DIR, cfg.assets.logoFooter.path)
    : path.join(assetsDir, "logos", clienteId, "footer.png");

  const headerPath = fs.existsSync(cfgHeader)
    ? cfgHeader
    : fs.existsSync(legacyHeaderPath)
    ? legacyHeaderPath
    : cfgHeader;

  const footerPath = fs.existsSync(cfgFooter)
    ? cfgFooter
    : fs.existsSync(legacyFooterPath)
    ? legacyFooterPath
    : cfgFooter;

  return { headerPath, footerPath, clienteId };
}

// Endpoint para obtener la configuración
app.get("/api/config", (req, res) => {
  try {
    const config = readConfigSafe();
    res.json(config);
  } catch (err) {
    res
      .status(500)
      .json({ error: "No se pudo leer config.json", details: err.message });
  }
});

// Endpoint para guardar la configuración
app.post("/api/config", (req, res) => {
  try {
    // Obtener la configuración actual
    const currentConfig = readConfigSafe();

    // Fusionar con los nuevos valores
    const newConfig = { ...currentConfig, ...req.body };

    // Guardar
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    res.json({
      success: true,
      message: "Configuración guardada correctamente",
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al guardar configuración", details: err.message });
  }
});

// (Extra) Endpoint para testear la impresora por TCP (puerto 9100)
app.get("/api/ping-printer", async (req, res) => {
  try {
    const cfg = readConfigSafe();
    const ip = (req.query.ip || cfg.printerIP || "").trim();
    const port = Number(req.query.port || cfg.printerPort || 9100);

    if (!ip) return res.status(400).json({ error: "IP no definida" });

    const ok = await new Promise((resolve) => {
      const socket = new net.Socket();
      let finished = false;

      socket.setTimeout(1500);

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
      } catch {
        if (!finished) {
          finished = true;
          try {
            socket.destroy();
          } catch {}
          resolve(false);
        }
      }
    });

    res.json({ success: ok, ip, port });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error en ping de impresora", details: err.message });
  }
});

// ------------------------- LOGOS -------------------------

// Endpoint para verificar si existen los logos
app.get("/api/logo-exists", (req, res) => {
  const { headerPath, footerPath } = resolveLogoPathsFromConfig();
  res.json({
    headerExists: fs.existsSync(headerPath),
    footerExists: fs.existsSync(footerPath),
    headerPath,
    footerPath,
  });
});

// Endpoint para obtener el logo del encabezado
app.get("/api/logo-header", (req, res) => {
  const { headerPath } = resolveLogoPathsFromConfig();
  if (fs.existsSync(headerPath)) {
    res.sendFile(headerPath);
  } else {
    res.status(404).json({ error: "No se encontró logo de encabezado" });
  }
});

// Endpoint para obtener el logo del pie
app.get("/api/logo-footer", (req, res) => {
  const { footerPath } = resolveLogoPathsFromConfig();
  if (fs.existsSync(footerPath)) {
    res.sendFile(footerPath);
  } else {
    res.status(404).json({ error: "No se encontró logo de pie" });
  }
});

// Endpoint para subir logo de encabezado (actualiza config.assets.logoHeader.path)
app.post("/api/upload-logo-header", upload.single("logo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    const { headerPath } = resolveLogoPathsFromConfig();
    fs.mkdirSync(path.dirname(headerPath), { recursive: true });

    // Procesar la imagen con sharp para optimizarla para impresoras térmicas
    await sharp(req.file.buffer)
      .resize({ width: 600, fit: "inside" }) // Ancho para logo de encabezado
      .greyscale() // Convertir a escala de grises
      .png()
      .toFile(headerPath);

    // Actualizar config con ruta versionada por cliente
    const cfg = readConfigSafe();
    const rel = path.relative(ROOT_DIR, headerPath).replace(/\\/g, "/");
    cfg.assets.logoHeader = {
      path: rel,
      version: (cfg.assets.logoHeader?.version || 0) + 1,
    };
    cfg.useHeaderLogo = true;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    res.json({
      success: true,
      message: "Logo de encabezado subido correctamente",
      path: rel,
    });
  } catch (err) {
    console.error("Error al procesar logo de encabezado:", err);
    res
      .status(500)
      .json({ error: "Error al procesar el logo", details: err.message });
  }
});

// Endpoint para subir logo de pie (actualiza config.assets.logoFooter.path)
app.post("/api/upload-logo-footer", upload.single("logo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    const { footerPath } = resolveLogoPathsFromConfig();
    fs.mkdirSync(path.dirname(footerPath), { recursive: true });

    // Procesar la imagen con sharp para optimizarla para impresoras térmicas
    await sharp(req.file.buffer)
      .resize({ width: 200, fit: "inside" }) // Ancho más pequeño para el pie
      .greyscale() // Convertir a escala de grises
      .png()
      .toFile(footerPath);

    // Actualizar config con ruta versionada por cliente
    const cfg = readConfigSafe();
    const rel = path.relative(ROOT_DIR, footerPath).replace(/\\/g, "/");
    cfg.assets.logoFooter = {
      path: rel,
      version: (cfg.assets.logoFooter?.version || 0) + 1,
    };
    cfg.useFooterLogo = true;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    res.json({
      success: true,
      message: "Logo de pie subido correctamente",
      path: rel,
    });
  } catch (err) {
    console.error("Error al procesar logo de pie:", err);
    res
      .status(500)
      .json({ error: "Error al procesar el logo", details: err.message });
  }
});

// Endpoint para eliminar logo de encabezado
app.delete("/api/logo-header", (req, res) => {
  try {
    const { headerPath } = resolveLogoPathsFromConfig();
    const exists = fs.existsSync(headerPath);
    if (exists) fs.unlinkSync(headerPath);

    // Si eliminamos el actual, dejar flag en false pero mantenemos assets.* por historial si querés
    const cfg = readConfigSafe();
    cfg.useHeaderLogo = false;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    res.json({
      success: true,
      message: exists
        ? "Logo de encabezado eliminado correctamente"
        : "No había logo de encabezado para eliminar",
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al eliminar el logo", details: err.message });
  }
});

// Endpoint para eliminar logo de pie
app.delete("/api/logo-footer", (req, res) => {
  try {
    const { footerPath } = resolveLogoPathsFromConfig();
    const exists = fs.existsSync(footerPath);
    if (exists) fs.unlinkSync(footerPath);

    const cfg = readConfigSafe();
    cfg.useFooterLogo = false;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    res.json({
      success: true,
      message: exists
        ? "Logo de pie eliminado correctamente"
        : "No había logo de pie para eliminar",
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al eliminar el logo", details: err.message });
  }
});

// ------------------------- IMPRESIÓN -------------------------

// Endpoint para imprimir plantillas (soporta impresión por lotes)
app.post("/api/imprimir", (req, res) => {
  const data = req.body;
  const templateId = data.templateId || "receipt"; // Por defecto se usa la plantilla de ticket

  console.log(`📦 Recibido trabajo de impresión con plantilla: ${templateId}`);

  try {
    // Comprobar si es una impresión por lotes
    const isBatchPrint =
      Array.isArray(data.products) && data.products.length > 0;

    if (isBatchPrint) {
      console.log(
        `🔄 Procesando impresión por lotes de ${data.products.length} productos`
      );

      // Validar cada producto en el lote
      const templates = require("../src/templates");
      const invalidProducts = [];

      // Creamos un array para guardar los trabajos de impresión
      const printJobs = data.products.map((product, index) => {
        // Create data object for each product
        const productData = {
          templateId: templateId,
          productName: product.productName,
          price: product.price,
          _templateInfo: {
            id: templateId,
            timestamp: new Date().toISOString(),
            batchId: `batch-${Date.now()}`,
            index: index,
            total: data.products.length,
          },
        };

        // Solo añadir header si existe y tiene un valor no vacío
        if (product.header && product.header.trim() !== "") {
          productData.header = product.header;
        }

        // Validate data against template
        const validacion = templates.validarDatosParaPlantilla(
          templateId,
          productData
        );
        if (!validacion.valid) {
          invalidProducts.push({
            index,
            productName: product.productName,
            errors: validacion.missingFields,
          });
        }

        return productData;
      });

      // Si hay productos inválidos, retornar error
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Datos inválidos para algunos productos",
          details: invalidProducts,
        });
      }

      // Guardar los trabajos de impresión por lotes
      fs.writeFileSync(
        tempPrintJobPath,
        JSON.stringify(
          {
            isBatchPrint: true,
            jobs: printJobs,
          },
          null,
          2
        )
      );

      // Tocar el archivo config.json para desencadenar el watcher del conector
      const configContent = readConfigSafe();
      fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2));

      console.log(
        `✅ Trabajo de impresión por lotes (${templateId}) enviado al conector`
      );
      res.json({
        success: true,
        message: `Trabajo de impresión por lotes con ${printJobs.length} productos enviado`,
      });
    } else {
      // Impresión individual
      const templates = require("../src/templates");
      const validacion = templates.validarDatosParaPlantilla(templateId, data);

      if (!validacion.valid) {
        return res.status(400).json({
          error: "Datos inválidos para la plantilla",
          details: `Campos faltantes: ${validacion.missingFields.join(", ")}`,
        });
      }

      // Guardar temporalmente el pedido y notificar al conector (index.js)
      const datosParaImprimir = {
        ...data,
        _templateInfo: {
          id: templateId,
          timestamp: new Date().toISOString(),
        },
      };

      fs.writeFileSync(
        tempPrintJobPath,
        JSON.stringify(datosParaImprimir, null, 2)
      );

      // Tocar config.json para desencadenar el watcher
      const configContent = readConfigSafe();
      fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2));

      console.log(
        `✅ Trabajo de impresión (${templateId}) enviado al conector`
      );
      res.json({
        success: true,
        message: `Trabajo de impresión con plantilla ${templateId} enviado`,
      });
    }
  } catch (err) {
    console.error(`❌ Error al procesar solicitud de impresión:`, err);
    res.status(500).json({
      error: "Error al procesar la solicitud de impresión",
      details: err.message,
    });
  }
});

// Ruta para la interfaz HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------------- FUENTES -------------------------

// Endpoint para subir una fuente personalizada
app.post("/api/upload-font", upload.single("font"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ error: "No se recibió ningún archivo de fuente" });
    }

    // Verificar la extensión del archivo
    if (!req.file.originalname.toLowerCase().endsWith(".ttf")) {
      return res.status(400).json({
        error: "Formato de archivo no válido. Solo se permiten archivos TTF",
      });
    }

    // Cargar la configuración para obtener el ID del cliente
    const config = readConfigSafe();
    const clienteId = config.clienteId || "cliente-default";

    // Guardar temporalmente el archivo
    const tempPath = path.join(ROOT_DIR, "temp-font.ttf");
    fs.writeFileSync(tempPath, req.file.buffer);

    // Registrar la fuente
    try {
      await fontRenderer.registrarFuente(clienteId, tempPath);

      // Eliminar el archivo temporal
      fs.unlinkSync(tempPath);

      res.json({
        success: true,
        message: "Fuente subida y procesada correctamente",
      });
    } catch (err) {
      console.error("Error al procesar la fuente:", err);
      res.status(500).json({
        error: "Error al procesar la fuente",
        details: err.message,
      });
    }
  } catch (err) {
    console.error("Error al subir fuente:", err);
    res.status(500).json({
      error: "Error al subir fuente",
      details: err.message,
    });
  }
});

// Endpoint para obtener información de la fuente actual
app.get("/api/font-info", (req, res) => {
  try {
    // Cargar la configuración para obtener el ID del cliente
    const config = readConfigSafe();
    const clienteId = config.clienteId || "cliente-default";

    // Obtener información de la fuente
    const fontInfo = fontRenderer.obtenerInfoFuente(clienteId);

    res.json({
      fontInfo,
      useFontTicket: config.useFontTicket || false,
    });
  } catch (err) {
    console.error("Error al obtener información de fuente:", err);
    res.status(500).json({
      error: "Error al obtener información de fuente",
      details: err.message,
    });
  }
});

// Endpoint para previsualizar texto con la fuente personalizada
app.get("/api/font-preview", async (req, res) => {
  try {
    const text = req.query.text || "Texto de ejemplo";

    // Cargar la configuración para obtener el ID del cliente
    const config = readConfigSafe();
    const clienteId = config.clienteId || "cliente-default";

    // Verificar que exista información de la fuente
    const fontInfo = fontRenderer.obtenerInfoFuente(clienteId);
    if (!fontInfo) {
      return res
        .status(404)
        .json({ error: "No hay fuente personalizada configurada" });
    }

    // Generar imagen con la fuente
    const imageBuffer = await fontRenderer.textoAImagen(clienteId, text, {
      fontSize: 28,
      centerText: true,
      backgroundColor: "#FFFFFF",
    });

    // Enviar imagen
    res.set("Content-Type", "image/png");
    res.send(imageBuffer);
  } catch (err) {
    console.error("Error al generar vista previa:", err);
    res.status(500).json({
      error: "Error al generar vista previa",
      details: err.message,
    });
  }
});

// Endpoint para eliminar una fuente
app.delete("/api/delete-font", (req, res) => {
  try {
    // Cargar la configuración para obtener el ID del cliente
    const config = readConfigSafe();
    const clienteId = config.clienteId || "cliente-default";

    // Eliminar la fuente
    const deleted = fontRenderer.eliminarFuente(clienteId);

    // Actualizar la configuración
    config.useFontTicket = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    res.json({
      success: deleted,
      message: deleted
        ? "Fuente eliminada correctamente"
        : "No había fuente para eliminar",
    });
  } catch (err) {
    console.error("Error al eliminar fuente:", err);
    res.status(500).json({
      error: "Error al eliminar fuente",
      details: err.message,
    });
  }
});

// Limpiar caché de fuentes periódicamente (cada 24 horas)
setInterval(() => {
  try {
    fontCache.limpiarCache();
    console.log("🧹 Caché de fuentes limpiado");
  } catch (err) {
    console.error("Error al limpiar caché:", err);
  }
}, 24 * 60 * 60 * 1000);

// ------------------------- PLANTILLAS -------------------------

// Endpoint para obtener todas las plantillas
app.get("/api/templates", (req, res) => {
  try {
    const templates = templateSystem.obtenerTodasLasPlantillas();
    res.json(templates);
  } catch (err) {
    console.error("❌ Error al obtener plantillas:", err);
    res.status(500).json({
      error: "Error al obtener plantillas",
      details: err.message,
    });
  }
});

// Endpoint para obtener una plantilla específica
app.get("/api/templates/:id", (req, res) => {
  try {
    const templateId = req.params.id;
    const template = templateSystem.obtenerPlantilla(templateId);

    if (!template) {
      return res.status(404).json({
        error: "Plantilla no encontrada",
        details: `No existe una plantilla con ID: ${templateId}`,
      });
    }

    res.json(template);
  } catch (err) {
    console.error(`❌ Error al obtener plantilla ${req.params.id}:`, err);
    res.status(500).json({
      error: "Error al obtener plantilla",
      details: err.message,
    });
  }
});

// Endpoint para crear o actualizar una plantilla
app.post("/api/templates", (req, res) => {
  try {
    const template = req.body;

    if (!template || !template.id) {
      return res.status(400).json({
        error: "Datos de plantilla inválidos",
        details: "Se requiere al menos un ID de plantilla",
      });
    }

    const saved = templateSystem.guardarPlantilla(template);

    if (saved) {
      res.json({
        success: true,
        message: `Plantilla ${template.id} guardada correctamente`,
        template,
      });
    } else {
      res.status(500).json({
        error: "Error al guardar plantilla",
        details: "No se pudo guardar la plantilla",
      });
    }
  } catch (err) {
    console.error("❌ Error al guardar plantilla:", err);
    res.status(500).json({
      error: "Error al guardar plantilla",
      details: err.message,
    });
  }
});

// Endpoint para eliminar una plantilla
app.delete("/api/templates/:id", (req, res) => {
  try {
    const templateId = req.params.id;
    const deleted = templateSystem.eliminarPlantilla(templateId);

    if (deleted) {
      res.json({
        success: true,
        message: `Plantilla ${templateId} eliminada correctamente`,
      });
    } else {
      res.status(404).json({
        error: "Plantilla no encontrada",
        details: `No existe una plantilla con ID: ${templateId}`,
      });
    }
  } catch (err) {
    console.error(`❌ Error al eliminar plantilla ${req.params.id}:`, err);
    res.status(500).json({
      error: "Error al eliminar plantilla",
      details: err.message,
    });
  }
});

/* ============================================================
   Assets Ingest - Genérico (URL Firebase o Upload directo)
   POST /api/assets/import
   - JSON: { clienteId, kind, source: { type:"url", url } }
   - multipart/form-data: fields clienteId, kind, file
   kinds soportados: "logo-header" | "logo-footer" | "font-ttf"
   ============================================================ */

// Allowlist de dominios para descarga remota
const ALLOWED_HOSTS = new Set([
  "firebasestorage.googleapis.com",
  "firebasestorage.app",
]);

function isAllowedHost(h) {
  if (!h) return false;
  if (ALLOWED_HOSTS.has(h)) return true;
  return h.endsWith(".firebasestorage.app");
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeAtomic(finalPath, buffer) {
  const tmp = `${finalPath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, finalPath);
}

function readJSONSafe(p, fallback = {}) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function bumpAssetVersion(cfg, key, extra = {}) {
  cfg.assets = cfg.assets || {};
  const current = cfg.assets[key] || {};
  const nextVersion =
    typeof current.version === "number" ? current.version + 1 : 1;
  cfg.assets[key] = { ...current, version: nextVersion, ...extra };
}

async function downloadWithValidation(fileUrl, expectedKind) {
  const { hostname } = new URL(fileUrl);
  if (!isAllowedHost(hostname)) {
    const err = new Error(`Host no permitido: ${hostname}`);
    err.code = "DISALLOWED_HOST";
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s
  let resp;
  try {
    // Node 18+ trae fetch global
    resp = await fetch(fileUrl, { signal: controller.signal });
  } catch (e) {
    throw new Error(`No se pudo descargar el asset (${e.message})`);
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar asset`);

  const contentType = resp.headers.get("content-type") || "";
  const buf = Buffer.from(await resp.arrayBuffer());

  // Validaciones simples por tipo
  if (expectedKind === "font-ttf") {
    if (
      !/font\/ttf|application\/octet-stream/.test(contentType) &&
      !fileUrl.toLowerCase().endsWith(".ttf")
    ) {
      throw new Error(`Content-Type inválido para TTF: ${contentType}`);
    }
  } else if (expectedKind === "logo-header" || expectedKind === "logo-footer") {
    if (!contentType.startsWith("image/")) {
      throw new Error(`Content-Type inválido para imagen: ${contentType}`);
    }
  }

  return { buf, contentType };
}

async function processLogo(buffer, variant) {
  const resizeWidth = variant === "logo-header" ? 600 : 200;
  return await sharp(buffer)
    .resize({ width: resizeWidth, fit: "inside" })
    .greyscale()
    .png()
    .toBuffer();
}

function resolveAssetPaths(clienteId, kind) {
  const baseLogos = path.join(assetsDir, "logos", clienteId);
  const baseFonts = path.join(assetsDir, "fonts", clienteId);

  if (kind === "logo-header") {
    ensureDir(baseLogos);
    return path.join(baseLogos, "header.png");
  }
  if (kind === "logo-footer") {
    ensureDir(baseLogos);
    return path.join(baseLogos, "footer.png");
  }
  if (kind === "font-ttf") {
    ensureDir(baseFonts);
    return path.join(baseFonts, "font.ttf");
  }
  throw new Error(`kind no soportado: ${kind}`);
}

function applyConfigFlagsByKind(cfg, kind) {
  if (kind === "logo-header") cfg.useHeaderLogo = true;
  if (kind === "logo-footer") cfg.useFooterLogo = true;
  if (kind === "font-ttf") cfg.useFontTicket = true;
}

function assetKeyByKind(kind) {
  if (kind === "logo-header") return "logoHeader";
  if (kind === "logo-footer") return "logoFooter";
  if (kind === "font-ttf") return "font";
  return kind;
}

app.post("/api/assets/import", upload.single("file"), async (req, res) => {
  try {
    // 1) Leer config y clienteId
    const cfg = readJSONSafe(configPath, {});
    const body = req.body || {};
    const clienteId = (body.clienteId || cfg.clienteId || "cliente-default")
      .toString()
      .trim();
    const kind = (body.kind || "").toString().trim();

    if (!kind) {
      return res
        .status(400)
        .json({ error: "Falta 'kind' (logo-header|logo-footer|font-ttf)" });
    }

    // 2) Obtener buffer: o de URL (JSON) o de upload (multipart)
    let buffer = null;
    let sourceType = null;

    const isMultipart = req.is("multipart/form-data");
    if (isMultipart && req.file) {
      sourceType = "upload";
      buffer = req.file.buffer;
      if (
        kind === "font-ttf" &&
        !req.file.originalname.toLowerCase().endsWith(".ttf")
      ) {
        return res
          .status(400)
          .json({ error: "Solo se permiten archivos .ttf para 'font-ttf'" });
      }
      if (
        (kind === "logo-header" || kind === "logo-footer") &&
        !req.file.mimetype.startsWith("image/")
      ) {
        return res
          .status(400)
          .json({ error: "Solo se permiten imágenes para logos" });
      }
    } else {
      if (!body.source || body.source.type !== "url" || !body.source.url) {
        return res.status(400).json({
          error:
            "Formato inválido. Enviar multipart con 'file' o JSON con { source: { type:'url', url } }",
        });
      }
      sourceType = "url";
      const { buf } = await downloadWithValidation(body.source.url, kind);
      buffer = buf;
    }

    // 3) Procesar según tipo
    const finalPath = resolveAssetPaths(clienteId, kind);
    let toWrite = buffer;
    let extraConfig = {};

    if (kind === "logo-header" || kind === "logo-footer") {
      toWrite = await processLogo(buffer, kind);
      // Escribir atomically
      writeAtomic(finalPath, toWrite);

      // 4) Actualizar config, flags y version
      const cfgNow = readJSONSafe(configPath, {});
      applyConfigFlagsByKind(cfgNow, kind);
      const rel = path.relative(ROOT_DIR, finalPath).replace(/\\/g, "/");
      const hash = sha256(toWrite);

      const key = assetKeyByKind(kind);
      bumpAssetVersion(cfgNow, key, { path: rel, sha256: hash });

      fs.writeFileSync(configPath, JSON.stringify(cfgNow, null, 2));
      fs.writeFileSync(configPath, JSON.stringify(cfgNow, null, 2)); // toque para watcher (si aplica)

      return res.json({
        success: true,
        message: `Asset ${kind} importado correctamente (${sourceType})`,
        asset: {
          kind,
          path: rel,
          version: cfgNow.assets[key].version,
          sha256: hash,
        },
      });
    }

    if (kind === "font-ttf") {
      // Guardar TTF atómicamente
      writeAtomic(finalPath, buffer);

      // Registrar/validar fuente con tu pipeline existente
      await fontRenderer.registrarFuente(clienteId, finalPath);

      // Info de fuente (family, etc.)
      const info = fontRenderer.obtenerInfoFuente(clienteId) || {};
      extraConfig.family = info.family || info.fontFamily || undefined;
      extraConfig.sha256 = sha256(buffer);

      const cfgNow = readJSONSafe(configPath, {});
      applyConfigFlagsByKind(cfgNow, kind);
      bumpAssetVersion(cfgNow, assetKeyByKind(kind), {
        path: path.relative(ROOT_DIR, finalPath).replace(/\\/g, "/"),
        ...extraConfig,
      });
      fs.writeFileSync(configPath, JSON.stringify(cfgNow, null, 2));
      fs.writeFileSync(configPath, JSON.stringify(cfgNow, null, 2)); // toque para watcher

      return res.json({
        success: true,
        message: `Fuente importada correctamente (${sourceType})`,
        asset: {
          kind,
          path: cfgNow.assets.font.path,
          version: cfgNow.assets.font.version,
          family: cfgNow.assets.font.family || extraConfig.family,
          sha256: cfgNow.assets.font.sha256,
        },
      });
    }

    throw new Error(`kind no soportado: ${kind}`);
  } catch (err) {
    console.error("❌ Error en /api/assets/import:", err);
    const code = err.code || "INGEST_ERROR";
    res.status(400).json({ error: code, details: err.message });
  }
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`🛠️ Config UI corriendo en http://localhost:${PORT}`);
});
