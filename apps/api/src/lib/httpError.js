// 可帶 HTTP status 的錯誤類別，方便 route 主動丟出
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export const notFound = (msg = '找不到資源') => new HttpError(404, msg);
export const badRequest = (msg = '請求格式錯誤') => new HttpError(400, msg);
export const unauthorized = (msg = '未授權') => new HttpError(401, msg);
export const conflict = (msg = '衝突') => new HttpError(409, msg);
