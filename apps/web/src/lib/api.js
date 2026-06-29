// 與後端 API 溝通的薄封裝
// dev：BASE 留 '/api'，走 vite proxy（/api → http://localhost:3000，免 CORS）
// 正式（如 Render）：設 VITE_API_BASE_URL 為後端完整網址，直接打後端
import { getToken, clearToken } from './auth.js';

const BASE = import.meta.env.VITE_API_BASE_URL || '/api';

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `請求失敗（${res.status}）`);
  }
  return json;
}

// ── 公開 ──
export const getCards = (params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v),
  ).toString();
  return request(`/cards${qs ? `?${qs}` : ''}`);
};
export const getCard = (id) => request(`/cards/${id}`);
export const getCardPrices = (id) => request(`/cards/${id}/prices`);

// ── 管理者 ──
export const login = (email, password) =>
  request('/admin/auth/login', { method: 'POST', body: { email, password } });

export const adminCreateCard = (data) =>
  request('/admin/cards', { method: 'POST', body: data, auth: true });

export const adminAddSource = (cardId, data) =>
  request(`/admin/cards/${cardId}/sources`, { method: 'POST', body: data, auth: true });

export const adminSyncCard = (cardId) =>
  request(`/admin/cards/${cardId}/price-sync`, { method: 'POST', auth: true });

export const adminSyncAll = () =>
  request('/admin/jobs/price-sync', { method: 'POST', auth: true });

export const adminGetJobs = () => request('/admin/jobs', { auth: true });
