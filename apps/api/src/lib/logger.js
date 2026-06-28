// 極簡 logger － 真正專案可換成 pino / winston
const ts = () => new Date().toISOString();

export const logger = {
  info: (...args) => console.log(`[INFO ] ${ts()}`, ...args),
  warn: (...args) => console.warn(`[WARN ] ${ts()}`, ...args),
  error: (...args) => console.error(`[ERROR] ${ts()}`, ...args),
};
