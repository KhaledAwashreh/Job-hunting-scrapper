/**
 * Logger Utility - Structured logging with levels
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'] || LOG_LEVELS.INFO;

class Logger {
  log(level, message, meta = {}) {
    if (LOG_LEVELS[level] >= CURRENT_LEVEL) {
      const time = new Date().toISOString();
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      console.log(`[${time}] [${level}] ${message}${metaStr}`);
    }
  }

  debug(msg, meta) {
    this.log('DEBUG', msg, meta);
  }

  info(msg, meta) {
    this.log('INFO', msg, meta);
  }

  warn(msg, meta) {
    this.log('WARN', msg, meta);
  }

  error(msg, meta) {
    this.log('ERROR', msg, meta);
  }
}

module.exports = new Logger();
