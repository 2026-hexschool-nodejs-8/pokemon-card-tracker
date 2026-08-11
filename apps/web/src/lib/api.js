// 與後端 API 溝通的薄封裝
// dev：BASE 留 '/api'，走 vite proxy（/api → http://localhost:3000，免 CORS）
// 正式（如 Render）：設 VITE_API_BASE_URL 為後端完整網址，直接打後端
import { getToken, clearToken } from './auth.js';

const BASE = import.meta.env.VITE_API_BASE_URL || '/api';

// request() 不在 React 樹內拿不到 useNavigate，由 App 掛載時把 navigate 註冊進來，
// session 失效時才能用 SPA 導頁而不是整頁重載
let navigate = null;
export const setNavigate = (fn) => {
  navigate = fn;
};

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

  // 需帶 token 的請求收到 401 = session 失效（過期／被撤銷）：
  // 清掉 token 並導向登入頁，避免各頁自己接 401、或停在殘缺畫面（FR-001）。
  // replace 讓失效的頁面不留在瀏覽紀錄，登入後按上一頁不會又跳回來。
  // 只在 auth 請求處理——登入失敗也是 401，那要留在原頁顯示錯誤訊息。
  if (auth && res.status === 401) {
    clearToken();
    navigate?.('/admin/login', { replace: true });
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
export const getCardPricesCsvUrl = (id) => `${BASE}/cards/${id}/prices.csv`;
export const getCardPriceSummary = (id) => request(`/cards/${id}/prices/summary`);

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

export const adminImportTcgplayer = (page, limit) =>
  request('/admin/import/tcgplayer', { method: 'POST', body: { page, limit }, auth: true });

export const adminSearchImportTcgplayer = (name, limit) =>
  request('/admin/import/tcgplayer/search', { method: 'POST', body: { name, limit }, auth: true });

export const adminClearStuckJobs = () =>
  request('/admin/jobs/clear-stuck', { method: 'POST', auth: true });

export const getPriceHistory = (id, range = 'quarter') =>
  request(`/cards/${id}/tcgplayer-history?range=${range}`);

// ── 後台總覽頁（卡片與來源管理）──
// 卡片清單（cursor 分頁，供無限滾動）；回傳 { data, nextCursor }
export const adminGetCards = ({ cursor, limit, keyword, language, grade, isActive } = {}) => {
  const params = {};
  if (cursor) params.cursor = cursor;
  if (limit) params.limit = limit;
  if (keyword) params.keyword = keyword;
  if (language) params.language = language;
  if (grade) params.grade = grade;
  // isActive 僅在 'true' / 'false' 時帶入（空字串=全部，不帶）
  if (isActive === 'true' || isActive === 'false') params.isActive = isActive;
  const qs = new URLSearchParams(params).toString();
  return request(`/admin/cards${qs ? `?${qs}` : ''}`, { auth: true });
};

// 某卡全部來源（延遲載入）；回傳 { data }
export const adminGetCardSources = (cardId) =>
  request(`/admin/cards/${cardId}/sources`, { auth: true });

// 切換卡片「追蹤」開關
export const adminToggleCard = (id, isActive) =>
  request(`/admin/cards/${id}`, { method: 'PATCH', body: { isActive }, auth: true });

// 切換來源「使用」開關（非最後啟用來源，或重新啟用）
export const adminToggleSource = (id, isActive) =>
  request(`/admin/sources/${id}`, { method: 'PATCH', body: { isActive }, auth: true });

// 關閉「最後一個啟用來源」（交易連動停用來源 + 卡片）
export const adminDeactivateLastSource = (id) =>
  request(`/admin/sources/${id}/deactivate-last`, { method: 'PATCH', auth: true });