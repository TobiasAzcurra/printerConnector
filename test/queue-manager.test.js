// test/queue-manager.test.js
// Unit tests for QueueManager using node:test (Node 22)
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

let queueDir, processingDir, tmpRoot;

function makeTmpDirs() {
  tmpRoot      = fs.mkdtempSync(path.join(os.tmpdir(), "qm-test-"));
  queueDir     = path.join(tmpRoot, "queue");
  processingDir = path.join(tmpRoot, "processing");
  fs.mkdirSync(queueDir);
  fs.mkdirSync(processingDir);
}

function cleanTmpDirs() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// We need a fresh QueueManager instance per test to avoid shared state.
// Require is cached, so we re-instantiate manually.
const QueueManager = require("../src/queue-manager");

test("enqueue increments pending and enqueued counters", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);
    const result = await qm.enqueue("job-001", { test: true });

    assert.equal(result.success, true);
    assert.equal(result.jobId, "job-001");

    const snap = qm.getSnapshot();
    assert.equal(snap.pending, 1);
    assert.equal(snap.enqueued, 1);
    assert.equal(snap.completed, 0);
    assert.equal(snap.failed, 0);
  } finally {
    cleanTmpDirs();
  }
});

test("counters reset when queue was empty before new job", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);

    // Simulate prior completed work
    qm.state.completed = 3;
    qm.state.failed    = 1;
    qm.state.enqueued  = 4;
    // Queue is empty (pending=[], processing=[])

    await qm.enqueue("job-001", { test: true });

    const snap = qm.getSnapshot();
    assert.equal(snap.completed, 0, "completed should reset");
    assert.equal(snap.failed,    0, "failed should reset");
    assert.equal(snap.enqueued,  1, "enqueued should restart from 1");
  } finally {
    cleanTmpDirs();
  }
});

test("counters do NOT reset when queue still has active jobs", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);

    // Simulate one job already pending
    qm.state.pending   = ["job-000"];
    qm.state.completed = 2;
    qm.state.failed    = 0;
    qm.state.enqueued  = 2;

    await qm.enqueue("job-001", { test: true });

    const snap = qm.getSnapshot();
    assert.equal(snap.completed, 2, "completed should not reset when queue active");
    assert.equal(snap.enqueued,  3, "enqueued should increment");
  } finally {
    cleanTmpDirs();
  }
});

test("markProcessing moves job from pending to processing", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);
    await qm.enqueue("job-001", { test: true });

    qm.markProcessing("job-001");

    const snap = qm.getSnapshot();
    assert.equal(snap.pending,    0);
    assert.equal(snap.processing, 1);
  } finally {
    cleanTmpDirs();
  }
});

test("markCompleted moves job out of processing and increments completed", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);
    await qm.enqueue("job-001", { test: true });
    qm.markProcessing("job-001");

    qm.markCompleted("job-001");

    const snap = qm.getSnapshot();
    assert.equal(snap.processing, 0);
    assert.equal(snap.completed,  1);
  } finally {
    cleanTmpDirs();
  }
});

test("markFailed moves job out of processing and increments failed", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);
    await qm.enqueue("job-001", { test: true });
    qm.markProcessing("job-001");

    qm.markFailed("job-001", new Error("printer offline"));

    const snap = qm.getSnapshot();
    assert.equal(snap.processing, 0);
    assert.equal(snap.failed,     1);
  } finally {
    cleanTmpDirs();
  }
});

test("listener is notified on state changes", async () => {
  makeTmpDirs();
  try {
    const qm = new QueueManager(queueDir, processingDir);
    let callCount = 0;
    qm.addListener(() => { callCount++; });

    await qm.enqueue("job-001", { test: true });
    assert.ok(callCount >= 1, "listener should be called on enqueue");
  } finally {
    cleanTmpDirs();
  }
});
