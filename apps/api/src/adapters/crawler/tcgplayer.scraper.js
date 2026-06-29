import { chromium } from 'playwright';
import axios from 'axios';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Content-Type': 'application/json',
  'Origin': 'https://www.tcgplayer.com',
  'Referer': 'https://www.tcgplayer.com/',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

function getHeaders() {
  const headers = { ...BASE_HEADERS };
  if (process.env.TCGPLAYER_COOKIE) {
    headers['Cookie'] = process.env.TCGPLAYER_COOKIE;
  }
  return headers;
}

export function extractProductIds(obj, result = []) {
  if (!obj || typeof obj !== 'object') return result;
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractProductIds(item, result));
    return result;
  }
  const idFields = ['productId', 'ProductId', 'product_id', 'id'];
  for (const field of idFields) {
    if (typeof obj[field] === 'number' && obj[field] > 0) {
      result.push(obj[field]);
    }
  }
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      extractProductIds(obj[key], result);
    }
  }
  return result;
}

export async function getProductIds(page = 1) {
  const searchUrl = `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&view=grid&ProductTypeName=Cards&page=${page}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: BASE_HEADERS['User-Agent'],
    locale: 'zh-TW',
  });
  const tab = await context.newPage();
  const productIds = [];

  tab.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) return;
    if (!url.includes('tcgplayer.com') && !url.includes('tcgapi')) return;
    try {
      const body = await response.json();
      extractProductIds(body, productIds);
    } catch {
      // 忽略解析失敗
    }
  });

  await tab.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await tab.waitForTimeout(3000);
  await browser.close();

  if (productIds.length === 0) {
    throw new Error('無法從搜尋頁取得 productId，請確認頁面是否正常載入或設定 TCGPLAYER_COOKIE');
  }

  return [...new Set(productIds)];
}

export async function scrapeCard(productId) {
  const headers = getHeaders();

  const [latestSalesRes, spotlightRes] = await Promise.all([
    axios.post(
      `https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales?mpfev=5293`,
      { conditions: [], languages: [1], variants: [], listingType: 'All', limit: 25 },
      { headers },
    ),
    axios.post(
      `https://data.tcgplayer.com/spotlight/search/${productId}`,
      { context: { shippingCountry: 'TW', cart: { packages: {} } } },
      { headers },
    ),
  ]);

  const salesData = latestSalesRes.data?.data || [];
  const spotlightData = spotlightRes.data?.spotlight || {};
  const name = salesData[0]?.title || `Product ${productId}`;
  const price = spotlightData.price ?? salesData[0]?.purchasePrice ?? null;

  return {
    productId,
    name,
    imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`,
    price,
  };
}
