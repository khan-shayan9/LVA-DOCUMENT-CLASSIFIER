// Reusable timestamped logger utility
const getTimestamp = () => {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
};

const logger = {
  // Informational messages
  info: (message) => {
    console.log(`[${getTimestamp()}] [INFO]  ${message}`);
  },

  // Success messages
  success: (message) => {
    console.log(`[${getTimestamp()}] [OK]    ${message}`);
  },

  // Warnings
  warn: (message) => {
    console.warn(`[${getTimestamp()}] [WARN]  ${message}`);
  },

  // Error messages with optional error object
  error: (message, err) => {
    console.error(`[${getTimestamp()}] [ERROR] ${message}`);
    if (err) {
      console.error(err);
    }
  },
};

module.exports = logger;

