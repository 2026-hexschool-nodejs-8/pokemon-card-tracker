// 包裝 async route handler，讓拋出的錯誤自動轉給 errorHandler
// （Express 4 不會自動 catch async 錯誤）
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
