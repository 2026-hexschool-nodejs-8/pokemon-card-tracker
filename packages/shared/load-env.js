// 共用的環境變數載入器（api / db seed 等進入點共用）。
//
// 用法：在進入點的「第一行」import（早於任何讀 process.env 的模組，如 jwt）：
//   import '@pct/shared/load-env';
//
// 從 monorepo 根 .env 載入。路徑用 import.meta.url 定位（錨在本檔位置），
// 與 process.cwd() 無關，所以不管從哪個 workspace 執行都對得到根 .env。
// 找不到 .env 時 dotenv 會安靜略過、且不覆蓋已存在的 process.env
//（正式環境由平台直接注入環境變數即屬此情況，例如 Render）。
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});
