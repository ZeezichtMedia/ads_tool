// ─── Structured Logger ───────────────────────────────────
// Consistent JSON logging with timestamps and levels.
// Replaces bare console.log for production observability.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

const formatMessage = (level, message, context = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };
  return JSON.stringify(entry);
};

export const logger = {
  debug: (msg, ctx) => currentLevel <= LEVELS.debug && console.log(formatMessage('debug', msg, ctx)),
  info:  (msg, ctx) => currentLevel <= LEVELS.info  && console.log(formatMessage('info', msg, ctx)),
  warn:  (msg, ctx) => currentLevel <= LEVELS.warn  && console.warn(formatMessage('warn', msg, ctx)),
  error: (msg, ctx) => currentLevel <= LEVELS.error && console.error(formatMessage('error', msg, ctx)),
};
