// 產出 docs/openapi.json，供 Postman / codegen 使用
// 從 repo 根目錄：npm run docs:openapi
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../docs/openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../../../../docs/openapi.json');

const document = buildOpenApiDocument();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outPath}`);
