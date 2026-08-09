// 共用回應形狀 － 描述 res.json() 之後的 JSON（日期已是 ISO 字串）
import { z } from 'zod';

/** 把 payload schema 包進統一的 { data } 信封 */
export function dataEnvelope(schema) {
  return z.object({ data: schema });
}

export const errorIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  issues: z.array(errorIssueSchema).optional(),
});

// GET /health － 基礎設施探針，不套用 { data } 信封
export const healthSchema = z.object({
  status: z.string(),
  service: z.string(),
  time: z.string().datetime(),
});
