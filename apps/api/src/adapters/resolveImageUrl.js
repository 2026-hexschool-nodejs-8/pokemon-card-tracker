/**
 * 把相對／絕對圖片路徑轉成絕對 URL；無效則回傳 undefined。
 * @param {string|undefined|null} href
 * @param {string} [baseUrl]
 * @returns {string|undefined}
 */
export function resolveImageUrl(href, baseUrl) {
  const trimmed = typeof href === 'string' ? href.trim() : '';
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return undefined;
  }
}
