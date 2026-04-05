/**
 * Type Helpers - Consistent array/string conversion utilities
 */

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function ensureString(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return '';
}

module.exports = {
  ensureArray,
  ensureString
};
