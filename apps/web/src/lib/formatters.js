// 統一前端時間顯示格式，沒有時間時以 - 表示。
export const fmtTime = (time) => (time ? new Date(time).toLocaleString('zh-TW') : '-');

// 統一價格顯示格式，可用於來源原始幣別價格與台幣平均價。
export const fmtPrice = (price, currency) =>
  price == null ? '\u5c1a\u672a\u66f4\u65b0' : `${currency ?? ''} ${price.toLocaleString()}`;

// 明確標示實際納入近期平均價計算的來源數，避免與表格中的過期來源混淆。
export const fmtSourceLabel = (count) =>
  count === 1 ? '1 \u500b\u8fd1\u671f\u4f86\u6e90' : `${count} \u500b\u8fd1\u671f\u4f86\u6e90\u5e73\u5747`;
