const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors"); // Para manejar solicitudes cross-origin
const multer = require("multer"); // Para manejar upload de archivos
const sharp = require("sharp"); // Para procesar imágenes
const fontRenderer = require("../src/font-renderer");
const fontCache = require("../src/font-renderer/cache");
const textRenderer = require("../src/font-renderer/text-renderer");
const templateSystem = require("../src/templates");

const app = express();
const PORT = 4040;

// Rutas a archivos y directorios importantes
const configPath = path.join(__dirname, "..", "config.json");
const assetsDir = path.join(__dirname, "..", "assets");
const fontsDir = path.join(assetsDir, "fonts"); // Directorio para fuentes
const logoHeaderPath = path.join(assetsDir, "logo-header.png");
const logoFooterPath = path.join(assetsDir, "logo-footer.png");
const tempPrintJobPath = path.join(__dirname, "..", "temp-print-job.json");

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

// Endpoint para obtener la configuración
app.get("/api/config", (req, res) => {
  try {
    if (!fs.existsSync(configPath)) {
      // Si no existe config.json, crearlo con valores por defecto
      const defaultConfig = {
        clienteId: "cliente-default",
        printerIP: "",
        printerPort: 9100,
        ticketWidth: 48,
        useHeaderLogo: true,
        useFooterLogo: true,
        useFontTicket: false, // Nuevo campo para controlar uso de fuente personalizada
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      return res.json(defaultConfig);
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    // Asegurar que los campos nuevos existan (para retrocompatibilidad)
    if (config.useHeaderLogo === undefined) config.useHeaderLogo = true;
    if (config.useFooterLogo === undefined) config.useFooterLogo = true;
    if (config.ticketWidth === undefined) config.ticketWidth = 48;
    if (config.useFontTicket === undefined) config.useFontTicket = false;

    // Retrocompatibilidad con configuración anterior
    if (config.useLogo !== undefined && config.useHeaderLogo === undefined) {
      config.useHeaderLogo = config.useLogo;
    }

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
    let currentConfig = {};
    if (fs.existsSync(configPath)) {
      currentConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }

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

// Endpoint para verificar si existen los logos
app.get("/api/logo-exists", (req, res) => {
  const headerExists = fs.existsSync(logoHeaderPath);
  const footerExists = fs.existsSync(logoFooterPath);
  res.json({
    headerExists,
    footerExists,
  });
});

// Endpoint para obtener el logo del encabezado
app.get("/api/logo-header", (req, res) => {
  if (fs.existsSync(logoHeaderPath)) {
    res.sendFile(logoHeaderPath);
  } else {
    res.status(404).json({ error: "No se encontró logo de encabezado" });
  }
});

// Endpoint para obtener el logo del pie
app.get("/api/logo-footer", (req, res) => {
  if (fs.existsSync(logoFooterPath)) {
    res.sendFile(logoFooterPath);
  } else {
    res.status(404).json({ error: "No se encontró logo de pie" });
  }
});

// Endpoint para subir logo de encabezado
app.post("/api/upload-logo-header", upload.single("logo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    // Procesar la imagen con sharp para optimizarla para impresoras térmicas
    await sharp(req.file.buffer)
      .resize({ width: 600, fit: "inside" }) // Ancho para logo de encabezado
      .greyscale() // Convertir a escala de grises
      .toFile(logoHeaderPath);

    res.json({
      success: true,
      message: "Logo de encabezado subido correctamente",
    });
  } catch (err) {
    console.error("Error al procesar logo de encabezado:", err);
    res
      .status(500)
      .json({ error: "Error al procesar el logo", details: err.message });
  }
});

// Endpoint para subir logo de pie
app.post("/api/upload-logo-footer", upload.single("logo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }

    // Procesar la imagen con sharp para optimizarla para impresoras térmicas
    await sharp(req.file.buffer)
      .resize({ width: 200, fit: "inside" }) // Ancho más pequeño para el pie
      .greyscale() // Convertir a escala de grises
      .toFile(logoFooterPath);

    res.json({ success: true, message: "Logo de pie subido correctamente" });
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
    if (fs.existsSync(logoHeaderPath)) {
      fs.unlinkSync(logoHeaderPath);
      res.json({
        success: true,
        message: "Logo de encabezado eliminado correctamente",
      });
    } else {
      res.json({
        success: true,
        message: "No había logo de encabezado para eliminar",
      });
    }
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al eliminar el logo", details: err.message });
  }
});

// Endpoint para eliminar logo de pie
app.delete("/api/logo-footer", (req, res) => {
  try {
    if (fs.existsSync(logoFooterPath)) {
      fs.unlinkSync(logoFooterPath);
      res.json({
        success: true,
        message: "Logo de pie eliminado correctamente",
      });
    } else {
      res.json({
        success: true,
        message: "No había logo de pie para eliminar",
      });
    }
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al eliminar el logo", details: err.message });
  }
});

// Endpoint para imprimir plantillas (modificado para soportar impresión por lotes)
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

      // Tocar el archivo config.json para desencadenar el watcher en index.js
      const configContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
      fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2));

      console.log(
        `✅ Trabajo de impresión por lotes (${templateId}) enviado al conector`
      );
      res.json({
        success: true,
        message: `Trabajo de impresión por lotes con ${printJobs.length} productos enviado`,
      });
    } else {
      // Código existente para impresión individual
      const templates = require("../src/templates");
      const validacion = templates.validarDatosParaPlantilla(templateId, data);

      if (!validacion.valid) {
        return res.status(400).json({
          error: "Datos inválidos para la plantilla",
          details: `Campos faltantes: ${validacion.missingFields.join(", ")}`,
        });
      }

      // Guardar temporalmente el pedido y notificar al index.js
      // Añadimos el templateId al objeto para que el conector sepa qué plantilla usar
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

      // Tocar el archivo config.json para desencadenar el watcher en index.js
      const configContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const clienteId = config.clienteId || "cliente-default";

    // Guardar temporalmente el archivo
    const tempPath = path.join(__dirname, "..", "temp-font.ttf");
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
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
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

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`🛠️ Config UI corriendo en http://localhost:${PORT}`);
});
