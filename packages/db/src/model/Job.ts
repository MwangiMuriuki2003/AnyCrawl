import { asc } from "drizzle-orm";
import { getDB, schemas, eq, STATUS, sql } from "../index.js";
import { JOB_RESULT_STATUS, JobResultStatus } from "../map.js";

export interface CreateJobParams {
    job_id: string;
    job_type: string;
    job_queue_name: string;
    url: string;
    req: {
        ip?: string;
        body?: any;
        auth?: { uuid?: string };
    };
    payload?: any;
    status?: string;
    is_success?: boolean;
}

export class Job {
    // Job type to expiration duration (ms)
    private static readonly JOB_TYPE_EXPIRE_MAP: Record<string, number> = {
        crawl: 3 * 60 * 60 * 1000, // 3 hours
        scrape: 1 * 60 * 60 * 1000, // 1 hour
        // add more types as needed
    };

    private static getJobExpireAt(job_type: string): Date {
        const duration = this.JOB_TYPE_EXPIRE_MAP[job_type] ?? (1 * 60 * 60 * 1000); // default 1 hour
        return new Date(Date.now() + duration);
    }

    private static extractReqMeta(req: {
        ip?: string;
        body?: any;
        auth?: { uuid?: string };
    }) {
        return {
            origin: req.ip,
            api_key_id: req.auth?.uuid,
        };
    }

    /**
     * Create a job in the jobs table
     */
    public static async create({
        job_id,
        job_type,
        job_queue_name,
        url,
        req,
        payload,
        status = STATUS.PENDING,
        is_success = false,
    }: CreateJobParams): Promise<void> {
        const db = await getDB();
        const { origin, api_key_id } = Job.extractReqMeta(req);
        const job_expire_at = Job.getJobExpireAt(job_type);

        await db.insert(schemas.jobs).values({
            jobId: job_id,
            jobType: job_type,
            jobQueueName: job_queue_name,
            jobExpireAt: job_expire_at,
            url,
            payload: payload ?? req.body,
            status: status,
            apiKey: api_key_id,
            origin: origin,
            isSuccess: is_success,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    /**
     * Get a job from the database
     * @param job_id - The ID of the job to get
     * @returns The job
     */
    public static async get(job_id: string) {
        const db = await getDB();
        const job = await db.select().from(schemas.jobs).where(eq(schemas.jobs.jobId, job_id)).limit(1);
        return job[0];
    }

    /**
     * Cancel a job
     * @param job_id - The ID of the job to cancel
     * @returns The cancelled job
     */
    public static async cancel(job_id: string) {
        const db = await getDB();
        const job = await Job.get(job_id);
        if (job) {
            await db.update(schemas.jobs).set({ status: STATUS.CANCELLED }).where(eq(schemas.jobs.jobId, job_id));
            return job;
        }
        return null;
    }

    /**
     * Update the status of a job
     * @param job_id - The ID of the job to update
     * @param status - The status to update the job to
     */
    public static async updateStatus(job_id: string, status: string, isSuccess: boolean | null = null) {
        const db = await getDB();
        if (isSuccess !== null) {
            await db.update(schemas.jobs).set({ status: status, isSuccess: isSuccess }).where(eq(schemas.jobs.jobId, job_id));
        } else {
            await db.update(schemas.jobs).set({ status: status }).where(eq(schemas.jobs.jobId, job_id));
        }
    }

    /**
     * Mark a job as completed
     * @param jobId - The ID of the job to mark as completed
     */
    public static async markAsCompleted(
        jobId: string,
        isSuccess: boolean = true,
        counts?: { total?: number; completed?: number; failed?: number }
    ) {
        const db = await getDB();
        await db.update(schemas.jobs).set({
            status: STATUS.COMPLETED,
            isSuccess: isSuccess,
            ...(counts?.total !== undefined ? { total: counts.total } : {}),
            ...(counts?.completed !== undefined ? { completed: counts.completed } : {}),
            ...(counts?.failed !== undefined ? { failed: counts.failed } : {}),
            updatedAt: new Date(),
        }).where(eq(schemas.jobs.jobId, jobId));
    }

    /**
     * Mark a job as pending
     * @param jobId - The ID of the job to mark as pending
     */
    public static async markAsPending(jobId: string) {
        await Job.updateStatus(jobId, STATUS.PENDING);
    }

    /**
     * Mark a job as failed
     * @param jobId - The ID of the job to mark as failed
     */
    public static async markAsFailed(
        jobId: string,
        errorMessage: string,
        isSuccess: boolean = false,
        counts?: { total?: number; completed?: number; failed?: number }
    ) {
        const db = await getDB();
        await db.update(schemas.jobs).set({
            status: STATUS.FAILED,
            isSuccess: isSuccess,
            errorMessage: errorMessage,
            ...(counts?.total !== undefined ? { total: counts.total } : {}),
            ...(counts?.completed !== undefined ? { completed: counts.completed } : {}),
            ...(counts?.failed !== undefined ? { failed: counts.failed } : {}),
            updatedAt: new Date(),
        }).where(eq(schemas.jobs.jobId, jobId));
    }

    /**
     * Insert a job result into the job_results table
     * @param jobId - The string ID of the job
     * @param url - The URL that was processed
     * @param data - The extracted data
     * @param status - The status of this particular result (e.g., 'success', 'failed')
     */
    public static async insertJobResult(jobId: string, url: string, data: any, status: JobResultStatus = JOB_RESULT_STATUS.SUCCESS) {
        const db = await getDB();

        // First, get the job by jobId to obtain its UUID
        const job = await Job.get(jobId);
        if (!job) {
            throw new Error(`Job with ID ${jobId} not found`);
        }

        await db.insert(schemas.jobResults).values({
            jobUuid: job.uuid, // Use the job's UUID as foreign key
            url: url,
            data: data,
            status: status,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    /**
     * Get all results for a job
     * @param jobId - The string ID of the job
     * @returns Array of job results
     */
    public static async getJobResults(jobId: string) {
        const db = await getDB();

        // First, get the job by jobId to obtain its UUID
        const job = await Job.get(jobId);
        if (!job) {
            throw new Error(`Job with ID ${jobId} not found`);
        }

        return await db.select().from(schemas.jobResults).where(eq(schemas.jobResults.jobUuid, job.uuid));
    }

    /**
     * Get paginated results for a job
     * @param jobId - The job ID
     * @param skip - Number of records to skip
     * @param limit - Max number of records to return
     */
    public static async getJobResultsPaginated(jobId: string, skip: number, limit: number) {
        const db = await getDB();

        const job = await Job.get(jobId);
        if (!job) {
            throw new Error(`Job with ID ${jobId} not found`);
        }

        return await db
            .select()
            .from(schemas.jobResults)
            .where(eq(schemas.jobResults.jobUuid, job.uuid))
            .orderBy(asc(schemas.jobResults.createdAt))
            .limit(limit)
            .offset(skip);
    }

    /**
     * Get total count of results for a job
     */
    public static async getJobResultsCount(jobId: string): Promise<number> {
        const db = await getDB();

        const job = await Job.get(jobId);
        if (!job) {
            throw new Error(`Job with ID ${jobId} not found`);
        }

        const rows = await db
            .select({ count: sql<number>`count(*)` })
            .from(schemas.jobResults)
            .where(eq(schemas.jobResults.jobUuid, job.uuid));
        const count = rows?.[0]?.count as unknown as number;
        return Number(count || 0);
    }
}