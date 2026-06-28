// 來源 adapter 的標準輸出契約 － 對應 PRD 第十五章
//
// 每個 adapter 都實作：
//   { type, name, async fetchPrice(source) => PriceResult }
//
// PriceResult 形狀（price 與 rawText 至少一個存在；service 會用 normalizePrice 統一清洗）：
//   {
//     provider: string,      // 來源名稱
//     price?: number,        // 已是數字的價格（api 來源常見）
//     rawText?: string,      // 原始價格文字，例如 "¥12,345"（crawler 來源常見）
//     currency: string,      // 幣別
//     fetchedAt: string,     // ISO 時間字串
//   }

export function assertPriceResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('adapter 回傳格式錯誤：非物件');
  }
  if (result.price === undefined && result.rawText === undefined) {
    throw new Error('adapter 回傳缺少 price 或 rawText');
  }
  if (!result.currency) {
    throw new Error('adapter 回傳缺少 currency');
  }
  return result;
}
