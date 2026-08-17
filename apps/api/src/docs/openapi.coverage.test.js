// 雙向比對：Express 實際掛載的路由 ↔ OpenAPI paths
// 不需 DB；新增端點若忘了寫文件（或文件殘留幽靈路徑）會失敗
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_MOUNTS } from '../app.js';
import { buildOpenApiDocument } from './openapi.js';

function joinPath(base, routePath) {
  if (!routePath || routePath === '/') return base;
  const suffix = routePath.startsWith('/') ? routePath : `/${routePath}`;
  // Express 允許 base=/admin、route=/jobs → /admin/jobs；避免雙斜線
  return `${base.replace(/\/$/, '')}${suffix}`;
}

/** Express :id → OpenAPI {id} */
function toOpenApiPath(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function collectMountedRoutes() {
  const routes = new Set();
  for (const [basePath, router] of ROUTE_MOUNTS) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const fullPath = toOpenApiPath(joinPath(basePath, layer.route.path));
      for (const method of Object.keys(layer.route.methods)) {
        if (!layer.route.methods[method]) continue;
        routes.add(`${method.toUpperCase()} ${fullPath}`);
      }
    }
  }
  return routes;
}

function collectDocumentedRoutes(document) {
  const routes = new Set();
  for (const [path, ops] of Object.entries(document.paths || {})) {
    for (const method of Object.keys(ops)) {
      // 忽略 OpenAPI 擴充鍵（如 parameters 掛在 path 層級時）
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'].includes(method)) {
        continue;
      }
      routes.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return routes;
}

function sortedDiff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

test('OpenAPI 覆蓋所有已掛載路由（雙向）', () => {
  const mounted = collectMountedRoutes();
  const documented = collectDocumentedRoutes(buildOpenApiDocument());

  const missingInDocs = sortedDiff(mounted, documented);
  const ghostsInDocs = sortedDiff(documented, mounted);

  assert.equal(
    missingInDocs.length,
    0,
    `以下路由已掛載但未寫進 OpenAPI：\n${missingInDocs.join('\n')}`,
  );
  assert.equal(
    ghostsInDocs.length,
    0,
    `以下路徑在 OpenAPI 有文件但實際未掛載：\n${ghostsInDocs.join('\n')}`,
  );

  // 鎖住目前的端點數量，避免兩邊同時漏掉卻剛好相等
  assert.equal(mounted.size, 25, `預期 25 支端點，實際掛載 ${mounted.size}`);
});
