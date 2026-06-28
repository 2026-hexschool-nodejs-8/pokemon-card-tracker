// 管理者 token 的本機儲存
const KEY = 'pct_admin_token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);
export const isLoggedIn = () => !!getToken();
