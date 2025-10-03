// src/print-logos.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT_DIR = path.join(__dirname, "..");

// Legacy (compat)
const LEGACY_HEADER = path.join(ROOT_DIR, "assets", "logo-header.png");
const LEGACY_FOOTER = path.join(ROOT_DIR, "assets", "logo-footer.png");

function resolveHeaderPath(config) {
  const clienteId = (config?.clienteId || "cliente-default").toString().trim();
  const perClient = path.join(
    ROOT_DIR,
    "assets",
    "logos",
    clienteId,
    "header.png"
  );
  if (fs.existsSync(perClient)) return perClient;
  if (fs.existsSync(LEGACY_HEADER)) return LEGACY_HEADER;
  return null;
}

function resolveFooterPath(config) {
  const clienteId = (config?.clienteId || "cliente-default").toString().trim();
  const perClient = path.join(
    ROOT_DIR,
    "assets",
    "logos",
    clienteId,
    "footer.png"
  );
  if (fs.existsSync(perClient)) return perClient;
  if (fs.existsSync(LEGACY_FOOTER)) return LEGACY_FOOTER;
  return null;
}

async function printHeaderLogo(printer, config) {
  if (!config?.useHeaderLogo) return;
  const p = resolveHeaderPath(config);
  if (!p) return;

  try {
    // tamaño generoso para encabezado
    const tmp = path.join(ROOT_DIR, `tmp-header-${Date.now()}.png`);
    printer.alignCenter();

    await sharp(p).resize({ width: 400, fit: "inside" }).png().toFile(tmp);
    printer.alignCenter();
    await printer.printImage(tmp);
    fs.unlinkSync(tmp);
  } catch (e) {
    console.error("⚠️ No se pudo imprimir header logo:", e.message);
  }
}

async function printFooterLogo(printer, config) {
  if (!config?.useFooterLogo) return;
  const p = resolveFooterPath(config);
  if (!p) return;

  try {
    // tamaño más chico para pie
    const tmp = path.join(ROOT_DIR, `tmp-footer-${Date.now()}.png`);
    await sharp(p).resize({ width: 100, fit: "inside" }).png().toFile(tmp);
    printer.alignCenter();
    await printer.printImage(tmp);
    fs.unlinkSync(tmp);
  } catch (e) {
    console.error("⚠️ No se pudo imprimir footer logo:", e.message);
  }
}

module.exports = {
  resolveHeaderPath,
  resolveFooterPath,
  printHeaderLogo,
  printFooterLogo,
};
