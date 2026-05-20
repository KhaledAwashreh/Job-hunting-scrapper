/**
 * Logger Utility - Structured logging with levels + file persistence
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = 'app.log';
const ERROR_FILE = 'errors.log';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'] || LOG_LEVELS.INFO;

// Track if we're in test mode
const isTestMode = process.env.NODE_ENV === 'test';

// Append a line to a log file
function appendToFile(filename, line) {
  try {
    fs.appendFileSync(filename, line + '\n');
  } catch (err) {
    // If file logging fails, at least log to console
    console.error('Failed to write to log file:', err.message);
  }
}

class Logger {
  log(level, message, meta = {}) {
    // Suppress logging in test mode
    if (isTestMode) return;

    if (LOG_LEVELS[level] >= CURRENT_LEVEL) {
      const time = new Date().toISOString();
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      const line = `[${time}] [${level}] ${message}${metaStr}`;

      // Always log to console
      console.log(line);

      // Log to file based on level
      if (level === 'ERROR') {
        appendToFile(ERROR_FILE, line);
      } else if (level === 'WARN') {
        appendToFile(LOG_FILE, line);
      }
      // DEBUG and INFO only go to file if LOG_LEVEL=DEBUG
      if (level === 'DEBUG' || level === 'INFO') {
        appendToFile(LOG_FILE, line);
      }
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
