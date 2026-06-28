// 驗證 Authorization: Bearer <token>，通過才放行後台 API
import { verifyToken } from '../lib/jwt.js';
import { unauthorized } from '../lib/httpError.js';

export function adminAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('缺少或格式錯誤的 Authorization header'));
  }

  try {
    req.admin = verifyToken(token); // { sub, email, role }
    next();
  } catch {
    next(unauthorized('token 無效或已過期'));
  }
}
