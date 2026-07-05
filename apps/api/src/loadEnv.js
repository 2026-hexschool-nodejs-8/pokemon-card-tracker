// 本機從 repo 根 .env 載入；Render 等平台已注入 process.env 時不覆蓋
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../../.env'),
});
