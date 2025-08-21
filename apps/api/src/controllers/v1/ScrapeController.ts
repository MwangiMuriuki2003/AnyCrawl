import { Response } from "express";
import { z } from "zod";
import { scrapeSchema } from "../../types/ScrapeSchema.js";
import { QueueManager, CrawlerErrorType } from "@anycrawl/scrape";
import { RequestWithAuth } from "../../types/Types.js";
import { STATUS, createJob, failedJob } from "@anycrawl/db";
export class ScrapeController {
    public handle = async (req: RequestWithAuth, res: Response): Promise<void> => {
        let jobId: string | null = null;
        let engineName: string | null = null;
        try {
            // Validate request body and transform it to the job payload structure
            const jobPayload = scrapeSchema.parse(req.body);

            jobId = await QueueManager.getInstance().addJob(`scrape-${jobPayload.engine}`, jobPayload);
            await createJob({
                job_id: jobId,
                job_type: 'scrape',
                job_queue_name: `scrape-${jobPayload.engine}`,
                url: jobPayload.url,
                req,
                status: STATUS.PENDING,
            });
            // Propagate jobId for downstream middlewares (e.g., credits logging)
            req.jobId = jobId;
            // waiting job done
            const job = await QueueManager.getInstance().waitJobDone(`scrape-${jobPayload.engine}`, jobId, jobPayload.options.timeout || 60_000);
            const { uniqueKey, queueName, options, engine, ...jobData } = job;
            // for failed job to cancel the job in the queue
            engineName = engine;
            // Check if job failed
            if (job.status === 'failed' || job.error) {
                const message = job.message || "The scraping task could not be completed";
                await QueueManager.getInstance().cancelJob(`scrape-${jobPayload.engine}`, jobId);
                await failedJob(jobId, message, false, { total: 1, completed: 0, failed: 1 });
                res.status(200).json({
                    success: false,
                    error: "Scrape task failed",
                    message: message,
                    data: {
                        ...jobData,
                    }
                });
                return;
            }

            // Set credits used for this scrape request (1 credit per scrape)
            req.creditsUsed = 1;
            // Extra credits when structured extraction is requested via json_options
            try {
                const extractJsonCredits = Number.parseInt(process.env.ANYCRAWL_EXTRACT_JSON_CREDITS || "0", 10);
                // jobPayload.options carries normalized options from schema, and must formats include json
                const hasJsonOptions = Boolean((jobPayload as any)?.options?.json_options) && (jobPayload as any)?.options?.formats?.includes("json");
                if (hasJsonOptions && Number.isFinite(extractJsonCredits) && extractJsonCredits > 0) {
                    req.creditsUsed += extractJsonCredits;
                }
            } catch {
                // ignore credit calc errors; default to base cost
            }

            // Add domain prefix to screenshot path if it exists
            if (jobData.screenshot) {
                jobData.screenshot = `${process.env.ANYCRAWL_DOMAIN}/v1/public/storage/file/${jobData.screenshot}`;
            }
            // Job completion is handled in worker/engine; no extra completedJob call here

            res.json({
                success: true,
                data: jobData,
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
                    await QueueManager.getInstance().cancelJob(`scrape-${engineName}`, jobId);
                    await failedJob(jobId, message, false, { total: 1, completed: 0, failed: 1 });
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
}
