import { z } from 'zod';
import { JOB_STATUS, JOB_TRIGGER_TYPE, LOG_STATUS } from '../../constants/index.js';

export const priceFetchLogSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  cardId: z.string().nullable(),
  sourceId: z.string().nullable(),
  status: z.enum([LOG_STATUS.SUCCESS, LOG_STATUS.FAILED]),
  message: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export const priceFetchJobSchema = z.object({
  id: z.string(),
  triggerType: z.enum([JOB_TRIGGER_TYPE.MANUAL, JOB_TRIGGER_TYPE.CRON]),
  status: z.enum([
    JOB_STATUS.RUNNING,
    JOB_STATUS.SUCCESS,
    JOB_STATUS.PARTIAL_SUCCESS,
    JOB_STATUS.FAILED,
  ]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  totalSources: z.number().int(),
  successCount: z.number().int(),
  failedCount: z.number().int(),
  errorMessage: z.string().nullable(),
});

export const jobWithLogsSchema = priceFetchJobSchema.extend({
  logs: z.array(priceFetchLogSchema),
});

export const clearStuckResultSchema = z.object({
  clearedCount: z.number().int(),
});
