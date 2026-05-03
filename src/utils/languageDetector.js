const franc = require('franc-min');

// Map franc 3-letter codes to language names
// Focus: European languages + Arabic
const LANG_CODE_MAP = {
  // Western Europe
  'eng': 'English',
  'fra': 'French',
  'fre': 'French',
  'spa': 'Spanish',
  'por': 'Portuguese',
  'deu': 'German',
  'ger': 'German',
  'nld': 'Dutch',
  'ita': 'Italian',
  'cat': 'Catalan',
  
  // Northern Europe
  'swe': 'Swedish',
  'nor': 'Norwegian',
  'dan': 'Danish',
  'fin': 'Finnish',
  'isl': 'Icelandic',
  
  // Eastern Europe
  'pol': 'Polish',
  'ces': 'Czech',
  'cze': 'Czech',
  'ron': 'Romanian',
  'rum': 'Romanian',
  'hun': 'Hungarian',
  'ell': 'Greek',
  'gre': 'Greek',
  'bul': 'Bulgarian',
  'hrv': 'Croatian',
  'slv': 'Slovenian',
  'slk': 'Slovak',
  'lit': 'Lithuanian',
  'lav': 'Latvian',
  'est': 'Estonian',
  
  // Middle East
  'ara': 'Arabic',
};

// Languages we actively support (for translation decisions)
const SUPPORTED_LANGUAGES = new Set([
  'English', 'French', 'Spanish', 'Portuguese', 'German', 'Dutch', 
  'Italian', 'Swedish', 'Norwegian', 'Danish', 'Finnish',
  'Polish', 'Czech', 'Romanian', 'Hungarian', 'Greek',
  'Arabic'
]);

/**
 * Detect the language of a text string
 * @param {string} text - Text to analyze
 * @returns {object} { code: 'eng', language: 'English', isSupported: true }
 */
function detectLanguage(text) {
  if (!text || text.length < 50) {
    return { code: 'eng', language: 'English', isSupported: true };
  }

  try {
    const code = franc(text, { minLength: 50 });
    
    // Handle "undetermined" or unknown
    if (!code || code === 'und') {
      return { code: 'eng', language: 'English', isSupported: true };
    }

    const language = LANG_CODE_MAP[code] || 'English';
    const isSupported = SUPPORTED_LANGUAGES.has(language);

    return { code, language, isSupported };
  } catch (error) {
    console.warn(`Language detection failed: ${error.message}`);
    return { code: 'eng', language: 'English', isSupported: true };
  }
}

/**
 * Check if a language is supported for translation
 * @param {string} language - Language name
 * @returns {boolean}
 */
function isLanguageSupported(language) {
  return SUPPORTED_LANGUAGES.has(language);
}

module.exports = {
  detectLanguage,
  isLanguageSupported,
  SUPPORTED_LANGUAGES,
  LANG_CODE_MAP
};
