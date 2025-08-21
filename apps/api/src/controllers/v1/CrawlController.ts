import { Response } from "express";
import { z } from "zod";
import { crawlSchema } from "../../types/CrawlSchema.js";
import { QueueManager, CrawlerErrorType, RequestTask } from "@anycrawl/scrape";
import { RequestWithAuth } from "../../types/Types.js";
import { randomUUID } from "crypto";
import { cancelJob, createJob, failedJob, getJob, getJobResultsPaginated, getJobResultsCount, STATUS } from "@anycrawl/db";
import { CrawlSchemaInput } from "../../types/CrawlSchema.js";
import { log } from "@anycrawl/libs";

export class CrawlController {
    /**
     * Start a crawl job
     */
    public start = async (req: RequestWithAuth, res: Response): Promise<void> => {
        let jobId: string | null = null;
        try {
            // Validate request body
            const jobPayload = crawlSchema.parse(req.body);
            // Add job to queue
            jobId = await QueueManager.getInstance().addJob(`crawl-${jobPayload.engine}`, jobPayload);

            req.creditsUsed = 0;

            await createJob({
                job_id: jobId,
                job_type: 'crawl',
                job_queue_name: `crawl-${jobPayload.engine}`,
                url: jobPayload.url,
                req,
            });

            // Return immediately with job ID (async processing)
            res.json({
                success: true,
                data: {
                    job_id: jobId,
                    status: 'created',
                    message: 'Crawl job has been queued for processing',
                }
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                const formattedErrors = error.errors.map((err) => ({
                    field: err.path.join("."),
                    message: err.message,
                    code: err.code,
                }));
                const message = error.errors.map((err) => err.message).join(", ");
                res.status(400).json({
                    success: false,
                    error: "Validation error",
                    message: message,
                    data: {
                        type: CrawlerErrorType.VALIDATION_ERROR,
                        issues: formattedErrors,
                        message: message,
                        status: 'failed',
                    },
                });
            } else {
                const message = error instanceof Error ? error.message : "Unknown error occurred";
                if (jobId) {
                    await failedJob(jobId, message);
                }
                res.status(500).json({
                    success: false,
                    error: "Internal server error",
                    message: message,
                    data: {
                        type: CrawlerErrorType.INTERNAL_ERROR,
                        message: message,
                        status: 'failed',
                    },
                });
            }
        }
    };

    /**
     * Get crawl job status
     */
    public status = async (req: RequestWithAuth, res: Response): Promise<void> => {
        try {
            const { jobId } = req.params;

            // validate uuid
            const parseResult = CrawlSchemaInput.safeParse({ uuid: jobId });
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: "Invalid job ID",
                    message: "Job ID must be a valid UUID"
                });
                return;
            }

            if (!jobId) {
                res.status(400).json({
                    success: false,
                    error: "Invalid job ID",
                    message: "Job ID must be a valid crawl job identifier"
                });
                return;
            }

            const job = await getJob(jobId);
            if (!job) {
                res.status(400).json({
                    success: false,
                    error: "Not found",
                    message: "Job not found"
                });
                return;
            }
            const queueJob = await QueueManager.getInstance().getJob(job.jobQueueName, jobId);
            // create job status for response
            const jobStatus = {
                job_id: jobId,
                status: job.status,
                start_time: new Date().toISOString(),
                expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
                credits_used: job.creditsUsed ?? 0,
                total: job.total ?? 0,
                completed: job.completed ?? 0,
                failed: job.failed ?? 0
            };

            res.json({
                success: true,
                message: 'Job status retrieved successfully',
                data: jobStatus
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error occurred";
            res.status(500).json({
                success: false,
                error: "Internal server error",
                message: message
            });
        }
    };

    /**
     * Get crawl job results
     * Supports skip via query param `skip`
     */
    public results = async (req: RequestWithAuth, res: Response): Promise<void> => {
        try {
            const { jobId } = req.params;
            // validate uuid
            const parseResult = CrawlSchemaInput.safeParse({ uuid: jobId });
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: "Invalid job ID",
                    message: "Job ID must be a valid UUID"
                });
                return;
            }

            if (!jobId) {
                res.status(400).json({
                    success: false,
                    error: "Invalid job ID",
                    message: "Job ID must be provided"
                });
                return;
            }

            const job = await getJob(jobId);
            if (!job) {
                res.status(400).json({
                    success: false,
                    error: "Not found",
                    message: "Job not found"
                });
                return;
            }

            const rawSkip = Array.isArray(req.query.skip) ? req.query.skip[0] : req.query.skip;
            const skip = Math.max(0, Number(rawSkip ?? 0) || 0);
            const MAX_PER_PAGE = 100;
            const [total, results] = await Promise.all([
                getJobResultsCount(jobId),
                getJobResultsPaginated(jobId, skip, MAX_PER_PAGE),
            ]);

            const hasMore = skip + results.length < total;
            const nextSkip = hasMore ? skip + results.length : undefined;
            const base = process.env.ANYCRAWL_DOMAIN || `${req.protocol}://${req.get('host')}`;
            const nextUrl = hasMore ? `${base}/v1/crawl/${jobId}/results?skip=${nextSkip}` : undefined;

            res.json({
                success: true,
                status: job.status,
                total: job.total ?? total,
                completed: job.completed ?? 0,
                creditsUsed: job.creditsUsed ?? 0,
                next: nextUrl,
                data: results.map((r: any) => ({ ...(r.data ?? {}), url: r.url })),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error occurred";
            res.status(500).json({
                success: false,
                error: "Internal server error",
                message: message
            });
        }
    };
    /**
     * Cancel a crawl job
     * @param req - The request object
     * @param res - The response object
     * @returns
     */
    public cancel = async (req: RequestWithAuth, res: Response): Promise<void> => {
        try {
            const { jobId } = req.params;
            // validate uuid
            const parseResult = CrawlSchemaInput.safeParse({ uuid: jobId });
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: "Invalid job ID",
                    message: "Job ID must be a valid UUID"
                });
                return;
            }
            if (!jobId) {
                res.status(400).json({
                    success: false,
                    error: "Invalid job ID",
                    message: "Job ID is required"
                });
                return;
            }
            const job = await getJob(jobId);
            if (!job) {
                res.status(404).json({
                    success: false,
                    error: "Not found",
                    message: "Job not found"
                });
                return;
            }
            // Disallow cancelling finished jobs
            if ([STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(job.status)) {
                res.status(409).json({
                    success: false,
                    error: "Job already finished",
                    message: "Finished jobs cannot be cancelled"
                });
                return;
            }

            await cancelJob(jobId);

            // cancel job in the bullmq queue (best-effort)
            try {
                await QueueManager.getInstance().cancelJob(job.jobQueueName, jobId);
            } catch (e) {
                // swallow queue cancellation error; DB status already set to cancelled and
                // engines will stop on cancel flag
            }

            res.status(200).json({
                success: true,
                message: "Job cancelled successfully",
                data: {
                    job_id: job.jobId,
                    status: 'cancelled',
                }
            });
        } catch (error) {
            log.error(JSON.stringify(error))
            const message = error instanceof Error ? error.message : "Unknown error occurred";
            res.status(500).json({
                success: false,
                error: "Internal server error",
                message: message
            });
        }
    };
} 