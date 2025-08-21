import IORedis from "ioredis";
import { Utils } from "../Utils.js";
import { JobManager } from "../core/JobManager.js";
import { completedJob, getDB, schemas, eq, sql } from "@anycrawl/db";

const REDIS_FIELDS = {
    ENQUEUED: "enqueued",
    DONE: "done",
    SUCCEEDED: "succeeded",
    FAILED: "failed",
    STARTED_AT: "started_at",
    FINISHED_AT: "finished_at",
    FINALIZED: "finalized",
    CANCELLED: "cancelled",
} as const;

/**
 * Progress manager for crawl jobs using Redis counters
 * Keys:
 *  - HSET crawl:{jobId} enqueued <number> done <number> succeeded <number> failed <number> started_at <ts> finished_at <ts> finalized 0|1
 */
export class ProgressManager {
    private static instance: ProgressManager;
    private redis: IORedis.Redis;

    private constructor() {
        this.redis = Utils.getInstance().getRedisConnection();
    }

    public static getInstance(): ProgressManager {
        if (!ProgressManager.instance) {
            ProgressManager.instance = new ProgressManager();
        }
        return ProgressManager.instance;
    }

    private key(jobId: string): string {
        return `crawl:${jobId}`;
    }

    private async getNumberField(jobId: string, field: string): Promise<number> {
        const key = this.key(jobId);
        try {
            const rawValue = await this.redis.hget(key, field);
            return Number(rawValue ?? 0);
        } catch {
            return 0;
        }
    }

    async ensureStarted(jobId: string): Promise<void> {
        const key = this.key(jobId);
        try {
            await this.redis.hsetnx(key, REDIS_FIELDS.STARTED_AT, new Date().toISOString());
        } catch {
            // ignore
        }
    }

    public async getEnqueued(jobId: string): Promise<number> {
        return this.getNumberField(jobId, REDIS_FIELDS.ENQUEUED);
    }

    public async getDone(jobId: string): Promise<number> {
        return this.getNumberField(jobId, REDIS_FIELDS.DONE);
    }

    public async isFinalized(jobId: string): Promise<boolean> {
        const key = this.key(jobId);
        try {
            const value = await this.redis.hget(key, REDIS_FIELDS.FINALIZED);
            return String(value ?? '0') === '1';
        } catch {
            return false;
        }
    }

    public async isCancelled(jobId: string): Promise<boolean> {
        const key = this.key(jobId);
        try {
            const value = await this.redis.hget(key, REDIS_FIELDS.CANCELLED);
            return String(value ?? '0') === '1';
        } catch {
            return false;
        }
    }

    async incrementEnqueued(jobId: string, incrementBy: number): Promise<void> {
        if (incrementBy <= 0) return;
        const key = this.key(jobId);
        const now = new Date().toISOString();
        await this.redis
            .multi()
            .hsetnx(key, REDIS_FIELDS.STARTED_AT, now)
            .hincrby(key, REDIS_FIELDS.ENQUEUED, incrementBy)
            .exec();
    }

    async markPageDone(
        jobId: string,
        wasSuccess: boolean
    ): Promise<{ done: number; enqueued: number }> {
        const key = this.key(jobId);
        // If already finalized, do not increment counters nor deduct credits again
        try {
            const finalized = await this.isFinalized(jobId);
            if (finalized) {
                const [enqueued, done] = await Promise.all([
                    this.getEnqueued(jobId),
                    this.getDone(jobId),
                ]);
                return { done, enqueued };
            }
        } catch { /* ignore and continue */ }
        const res = await this.redis
            .multi()
            .hincrby(key, REDIS_FIELDS.DONE, 1)
            .hincrby(key, wasSuccess ? REDIS_FIELDS.SUCCEEDED : REDIS_FIELDS.FAILED, 1)
            .hget(key, REDIS_FIELDS.ENQUEUED)
            .hget(key, REDIS_FIELDS.DONE)
            .exec();
        const enqueued = Number(res?.[2]?.[1] ?? 0);
        const done = Number(res?.[3]?.[1] ?? 0);

        // Increment DB counters per page (best-effort, atomic arithmetic) and deduct credits
        try {
            const db = await getDB();
            // Fetch job row ONCE for cost calculation, deduction and potential finalize
            let perPageCost = 1;
            let queueNameForFinalize: string | undefined;
            let apiKeyForDeduction: string | undefined;
            try {
                const [jobRow] = await db
                    .select({ apiKey: schemas.jobs.apiKey, queueName: schemas.jobs.jobQueueName, payload: schemas.jobs.payload })
                    .from(schemas.jobs)
                    .where(eq(schemas.jobs.jobId, jobId));
                apiKeyForDeduction = jobRow?.apiKey as string | undefined;
                queueNameForFinalize = jobRow?.queueName as string | undefined;
                const payload: any = jobRow?.payload ?? {};
                const hasJsonOptions = Boolean(
                    payload?.json_options || payload?.options?.scrape_options?.json_options
                ) && payload?.options?.formats?.includes("json");
                const extractJsonCreditsRaw = process.env.ANYCRAWL_EXTRACT_JSON_CREDITS || "0";
                const extractJsonCredits = Number.parseInt(extractJsonCreditsRaw, 10);
                if (hasJsonOptions && Number.isFinite(extractJsonCredits) && extractJsonCredits > 0) {
                    perPageCost += extractJsonCredits;
                }
            } catch { /* ignore: default perPageCost remains 1 */ }

            const updates: any = {
                total: sql`${schemas.jobs.total} + 1`,
                creditsUsed: sql`${schemas.jobs.creditsUsed} + ${perPageCost}`,
                updatedAt: new Date(),
            };
            if (wasSuccess) {
                updates.completed = sql`${schemas.jobs.completed} + 1`;
            } else {
                updates.failed = sql`${schemas.jobs.failed} + 1`;
            }
            await db.update(schemas.jobs).set(updates).where(eq(schemas.jobs.jobId, jobId));

            // Deduct credits from the API key balance per processed URL when credits are enabled
            if (process.env.ANYCRAWL_API_CREDITS_ENABLED === 'true' && apiKeyForDeduction) {
                try {
                    await db
                        .update(schemas.apiKey)
                        .set({
                            credits: sql`${schemas.apiKey.credits} - ${perPageCost}`,
                            lastUsedAt: new Date(),
                        })
                        .where(eq(schemas.apiKey.uuid, apiKeyForDeduction));

                    // Check remaining credits; if exhausted, finalize the job immediately
                    const [user] = await db
                        .select({ credits: schemas.apiKey.credits })
                        .from(schemas.apiKey)
                        .where(eq(schemas.apiKey.uuid, apiKeyForDeduction));
                    const remaining = user?.credits ?? 0;
                    if (remaining <= 0 && queueNameForFinalize) {
                        try {
                            await this.tryFinalize(jobId, queueNameForFinalize, {}, done);
                        } catch { /* ignore finalize race */ }
                    }
                } catch { /* ignore deduction errors */ }
            }
        } catch { }
        return { done, enqueued };
    }

    /**
     * Atomically finalize the job if done === enqueued and not finalized yet
     */
    async tryFinalize(
        jobId: string,
        queueName: string,
        summary?: Record<string, unknown>,
        finalizeTarget?: number
    ): Promise<boolean> {
        const key = this.key(jobId);
        const now = new Date().toISOString();
        // Lua script ensures atomic check-and-set
        const script = `
      local k = KEYS[1]
      local finalized = redis.call('HGET', k, '${REDIS_FIELDS.FINALIZED}')
      if finalized == '1' then return 0 end
      local enq = tonumber(redis.call('HGET', k, '${REDIS_FIELDS.ENQUEUED}') or '0')
      local done = tonumber(redis.call('HGET', k, '${REDIS_FIELDS.DONE}') or '0')
      local target = tonumber(ARGV[2] or '0')
      if target ~= nil and target > 0 and done >= target then
        redis.call('HSET', k, '${REDIS_FIELDS.FINALIZED}', '1')
        redis.call('HSET', k, '${REDIS_FIELDS.FINISHED_AT}', ARGV[1])
        return 1
      end
      if enq > 0 and done == enq then
        redis.call('HSET', k, '${REDIS_FIELDS.FINALIZED}', '1')
        redis.call('HSET', k, '${REDIS_FIELDS.FINISHED_AT}', ARGV[1])
        return 1
      end
      return 0
    `;
        const finalized = await this.redis.eval(
            script,
            1,
            key,
            now,
            String(finalizeTarget ?? 0)
        );

        if (Number(finalized) === 1) {
            // Read summary fields for reporting
            const fields = await this.redis.hgetall(key);
            const total = Number(fields[REDIS_FIELDS.ENQUEUED] ?? 0);
            const succeeded = Number(fields[REDIS_FIELDS.SUCCEEDED] ?? 0);
            const failed = Number(fields[REDIS_FIELDS.FAILED] ?? 0);
            const finalSummary = {
                total,
                succeeded,
                failed,
                started_at: fields[REDIS_FIELDS.STARTED_AT],
                finished_at: fields[REDIS_FIELDS.FINISHED_AT],
                ...(summary ?? {}),
            };
            // Mark in BullMQ job data
            await new JobManager().markCompleted(jobId, queueName as any, finalSummary);
            // Mark in DB: isSuccess when not all failed (i.e., succeeded > 0)

            try {
                await completedJob(jobId, succeeded > 0);
            } catch {
                // DB not configured or transient error; ignore to not block finalize
            }
            return true;
        }
        return false;
    }

    /**
     * Mark job as cancelled and finalized immediately.
     * Prevent further enqueueing and allow engines to short-circuit processing.
     */
    async cancel(jobId: string): Promise<void> {
        const key = this.key(jobId);
        const now = new Date().toISOString();
        try {
            await this.redis
                .multi()
                .hset(key, REDIS_FIELDS.CANCELLED, '1')
                .hset(key, REDIS_FIELDS.FINALIZED, '1')
                .hset(key, REDIS_FIELDS.FINISHED_AT, now)
                .exec();
        } catch {
            // ignore
        }
    }
}


