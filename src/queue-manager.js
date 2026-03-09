// queue-manager.js
const fs = require("fs");
const path = require("path");
const lockfile = require("proper-lockfile");
const { createLogger } = require("./logger");

const log = createLogger("QueueMgr");

class QueueManager {
  constructor(queueDir, processingDir) {
    this.queueDir = queueDir;
    this.processingDir = processingDir;

    // Estado en memoria
    this.state = {
      pending: [], // Array de jobIds pendientes
      processing: [], // Array de jobIds en proceso
      completed: 0, // Contador de completados
      failed: 0, // Contador de fallidos
      enqueued: 0, // Total encolados desde inicio
    };

    // Listeners para notificaciones
    this.listeners = [];

    // Inicializar sincronizando con disco
    this.syncFromDisk();

    // Reconciliación periódica cada 5 segundos
    setInterval(() => this.syncFromDisk(), 5000);
  }

  // Sincronizar estado en memoria con archivos en disco
  syncFromDisk() {
    try {
      // Leer pending
      if (fs.existsSync(this.queueDir)) {
        const pendingFiles = fs
          .readdirSync(this.queueDir)
          .filter((f) => f.endsWith(".json"))
          .sort();

        this.state.pending = pendingFiles.map((f) => f.replace(".json", ""));
      }

      // Leer processing
      if (fs.existsSync(this.processingDir)) {
        const processingFiles = fs
          .readdirSync(this.processingDir)
          .filter((f) => f.endsWith(".json"))
          .sort();

        this.state.processing = processingFiles.map((f) =>
          f.replace(".json", "")
        );
      }

      this.notifyListeners();
    } catch (err) {
      log.error("Error sincronizando estado desde disco:", err.message);
    }
  }

  // Agregar job a la cola
  async enqueue(jobId, jobData) {
    const jobPath = path.join(this.queueDir, `${jobId}.json`);

    try {
      // Crear directorio si no existe
      if (!fs.existsSync(this.queueDir)) {
        fs.mkdirSync(this.queueDir, { recursive: true });
      }

      // Escribir archivo con lock para evitar race conditions
      await this.writeFileAtomic(jobPath, JSON.stringify(jobData, null, 2));

      // Si la cola estaba vacía, resetear contadores de sesión para que el
      // toast muestre números del lote actual (ej: "1/3") en vez de acumulados.
      if (this.state.pending.length === 0 && this.state.processing.length === 0) {
        this.state.completed = 0;
        this.state.failed = 0;
        this.state.enqueued = 0;
      }

      // Actualizar estado en memoria
      this.state.pending.push(jobId);
      this.state.enqueued++;

      log.info(`Job encolado: ${jobId} — posición ${this.state.pending.length}`);

      this.notifyListeners();

      return {
        success: true,
        jobId,
        position: this.state.pending.length,
        total: this.state.pending.length + this.state.processing.length,
      };
    } catch (err) {
      log.error(`Error encolando job ${jobId}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Escribir archivo atómicamente con retry
  async writeFileAtomic(filePath, content, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const tempPath = `${filePath}.tmp-${Date.now()}`;
        fs.writeFileSync(tempPath, content);
        fs.renameSync(tempPath, filePath);
        return;
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  // Marcar job como completado (llamado por el worker)
  markCompleted(jobId) {
    // Remover de processing
    this.state.processing = this.state.processing.filter((id) => id !== jobId);
    this.state.completed++;

    log.info(`Job completado: ${jobId} — restantes: ${this.getTotalJobs()}`);

    this.notifyListeners();
  }

  // Marcar job como fallido
  markFailed(jobId, error) {
    this.state.processing = this.state.processing.filter((id) => id !== jobId);
    this.state.failed++;

    log.error(`Job fallido: ${jobId}`, error);

    this.notifyListeners();
  }

  // Marcar job como en proceso
  markProcessing(jobId) {
    this.state.pending = this.state.pending.filter((id) => id !== jobId);

    if (!this.state.processing.includes(jobId)) {
      this.state.processing.push(jobId);
    }

    this.notifyListeners();
  }

  // Obtener snapshot del estado actual
  getSnapshot() {
    return {
      pending: this.state.pending.length,
      processing: this.state.processing.length,
      completed: this.state.completed,
      failed: this.state.failed,
      total: this.state.pending.length + this.state.processing.length,
      enqueued: this.state.enqueued,
    };
  }

  getTotalJobs() {
    return this.state.pending.length + this.state.processing.length;
  }

  // Agregar listener para cambios de estado
  addListener(callback) {
    this.listeners.push(callback);
  }

  // Notificar a todos los listeners
  notifyListeners() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        log.error("Error en listener de estado:", err.message);
      }
    });
  }

  // Limpiar jobs completados viejos (opcional, para no llenar disco)
  cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) {
    // 24 horas por defecto
    // Implementar si es necesario
  }
}

module.exports = QueueManager;
