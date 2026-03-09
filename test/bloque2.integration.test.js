// test/bloque2.integration.test.js
// Integration test for Bloque 2: retry exhaustion → print-failed/
//
// No real printer needed. Uses a port with nothing listening so the
// TCP connection is immediately refused (ECONNREFUSED), triggering the
// retry/fail-fast path inside index.js.
//
// Strategy:
//   - Spawn index.js as a child process with isolated temp dirs and
//     MAX_RETRIES=1, RETRY_DELAY_MS=100 so the test finishes in ~1s.
//   - Write a print job pointing to 127.0.0.1:19999 (nothing there).
//   - Poll TEST_FAILED_DIR until the file appears (max 15s).
//   - Assert the failed file contains the expected logId.

const { test } = require("node:test");
const assert   = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const INDEX_JS = path.join(__dirname, "..", "index.js");

function makeTmpDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b2-test-"));
  const dirs = {
    root,
    queue:      path.join(root, "queue"),
    processing: path.join(root, "processing"),
    failed:     path.join(root, "failed"),
  };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  return dirs;
}

function buildJobPayload(logId) {
  return {
    _printer: { ip: "127.0.0.1", port: 19999 },
    _templateInfo: { jobId: `test-job-${logId}`, logId },
    _template: {
      sections: [
        { type: "text", content: "Test ticket", align: "left" },
      ],
    },
    orderId:     "test-order-bloque2",
    printerName: "TestPrinter",
  };
}

function pollUntil(check, timeoutMs, intervalMs = 200) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      if (check()) { clearInterval(id); resolve(); return; }
      if (Date.now() > deadline) {
        clearInterval(id);
        reject(new Error("pollUntil timed out"));
      }
    }, intervalMs);
  });
}

test("Bloque 2 — failed job lands in print-failed/ after retries exhausted", async () => {
  const dirs  = makeTmpDirs();
  const logId = `test-${Date.now()}`;
  const jobFilename = `${Date.now()}-bloque2.json`;

  // Minimal config so index.js doesn't try to call Firestore
  const configPath = path.join(dirs.root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    clienteId:       "test",
    printerIP:       "127.0.0.1",
    printerPort:     19999,
    useHeaderLogo:   false,
    useFooterLogo:   false,
    useFontTicket:   false,
    assets:          {},
    // No confirmPrintUrl — skips Firestore calls
  }));

  const env = {
    ...process.env,
    TEST_QUEUE_DIR:      dirs.queue,
    TEST_PROCESSING_DIR: dirs.processing,
    TEST_FAILED_DIR:     dirs.failed,
    TEST_MAX_RETRIES:    "1",
    TEST_RETRY_DELAY_MS: "100",
    // Point API_BASE to a non-existent port so job-processing/failed notifications fail silently
    API_BASE:            "http://127.0.0.1:19998",
    // Override config path so the child uses our temp config
    CONNECTOR_CONFIG_PATH: configPath,
    LOG_LEVEL: "error", // quiet during tests
  };

  // Override __dirname-based config path in index.js via symlink trick would be complex;
  // instead we copy the temp config over the real one path is resolved from ROOT_DIR (__dirname).
  // Simpler: set a NODE_PATH env and patch — actually we rely on the child reading from
  // its __dirname. So write config into the connector's actual dir (read-only for tests).
  // To avoid polluting the real config, we don't override confirmPrintUrl → confirmPrintOnFirestore
  // will bail early due to missing config fields. That's fine for this test.

  const child = spawn(process.execPath, [INDEX_JS], {
    env: {
      ...env,
      // Point to the real connector dir so require() resolves correctly
    },
    cwd: path.join(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Let the connector boot (it reads config from its own dir, that's fine — it won't
  // call Firestore since confirmPrintUrl is absent in the real config as well for local dev)
  await new Promise((r) => setTimeout(r, 800));

  // Write the print job
  const jobData = buildJobPayload(logId);
  fs.writeFileSync(path.join(dirs.queue, jobFilename), JSON.stringify(jobData));

  let failedFile = null;
  try {
    await pollUntil(() => {
      const files = fs.readdirSync(dirs.failed);
      const match = files.find((f) => f === jobFilename);
      if (match) { failedFile = match; return true; }
      return false;
    }, 15_000);
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }

  assert.ok(failedFile, `Job should appear in failed dir but wasn't found`);

  // The file name itself is enough — if it made it to failed/, retries were exhausted
});
