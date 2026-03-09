// src/logger.js
// Structured logger — format: <ISO timestamp> [LEVEL] [Tag] message
//
// Level filter: set LOG_LEVEL env var to debug|info|warn|error (default: info)
// pm2 routes stdout (debug/info) to out.log and stderr (warn/error) to error.log.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function createLogger(tag) {
  const prefix = (level) => `${ts()} [${level.padEnd(5)}] [${tag}]`;

  return {
    debug: (msg, ...args) => {
      if (minLevel > LEVELS.debug) return;
      console.log(prefix("DEBUG"), msg, ...args);
    },
    info: (msg, ...args) => {
      if (minLevel > LEVELS.info) return;
      console.log(prefix("INFO"), msg, ...args);
    },
    warn: (msg, ...args) => {
      if (minLevel > LEVELS.warn) return;
      console.warn(prefix("WARN"), msg, ...args);
    },
    error: (msg, ...args) => {
      if (minLevel > LEVELS.error) return;
      console.error(prefix("ERROR"), msg, ...args);
    },
  };
}

module.exports = { createLogger };
