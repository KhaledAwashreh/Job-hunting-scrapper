/**
 * Time Window Utilities - Handle job posting recency filtering
 * @module timeWindow
 */

const TIME_WINDOWS = {
  '7': { label: 'Last 7 days', days: 7 },
  '30': { label: 'Last 30 days', days: 30 },
  '90': { label: 'Last 90 days', days: 90 },
  '180': { label: 'Last 6 months', days: 180 },
  'all': { label: 'All time', days: null }
};

/**
 * Check if a publish date falls within the time window
 * @param {string} publishDate - ISO date string or null
 * @param {string} windowKey - '7', '30', '90', '180', or 'all'
 * @returns {boolean} true if within window or date is missing
 */
function isWithinTimeWindow(publishDate, windowKey = 'all') {
  // If no date provided, accept it (per requirements)
  if (!publishDate) return true;

  const window = TIME_WINDOWS[windowKey];
  if (!window || window.days === null) return true; // 'all' or unknown key

  try {
    const postDate = new Date(publishDate);
    const now = new Date();
    const daysDiff = (now - postDate) / (1000 * 60 * 60 * 24);

    return daysDiff <= window.days;
  } catch (e) {
    // Invalid date format, accept it
    return true;
  }
}

/**
 * Get all available time window options
 */
function getTimeWindowOptions() {
  return Object.entries(TIME_WINDOWS).map(([key, value]) => ({
    key,
    label: value.label,
    days: value.days
  }));
}

module.exports = {
  isWithinTimeWindow,
  getTimeWindowOptions,
  TIME_WINDOWS
};
