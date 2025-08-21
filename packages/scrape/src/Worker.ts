import { WorkerManager } from "./managers/Worker.js";
import { QueueManager } from "./managers/Queue.js";
import { Job } from "bullmq";
import { log } from "crawlee";
import { Utils } from "./Utils.js";
// Removed unused imports to keep startup lean
import { ProgressManager } from "./managers/Progress.js";
import { ALLOWED_ENGINES, JOB_TYPE_CRAWL, JOB_TYPE_SCRAPE } from "./constants.js";
import { ensureAIConfigLoaded } from "@anycrawl/ai/utils/config.js";
import { refreshAIConfig, getDefaultLLModelId, getEnabledProviderModels } from "@anycrawl/ai/utils/helper.js";

// Initialize Utils first
const utils = Utils.getInstance();
await utils.initializeKeyValueStore();

// Initialize queues and engines
// Ensure AI config is loaded (URL/file) before engines start
try {
    await ensureAIConfigLoaded();
    refreshAIConfig();
    const providers = Array.from(new Set(getEnabledProviderModels().map(p => p.provider)));
    const defaultModel = getDefaultLLModelId();
    log.info(`[ai] providers ready: ${providers.length > 0 ? providers.join(', ') : 'none'}`);
    if (defaultModel) log.info(`[ai] default model: ${defaultModel}`);
    // Validate extract model provider is actually registered
    try {
        const { getLLM, getExtractModelId } = await import("@anycrawl/ai");
        const extractId = getExtractModelId();
        getLLM(extractId);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warning(`[ai] validation: ${msg}. Check provider credentials (apiKey/baseURL) for the configured provider.`);
    }
} catch { }
log.info("Initializing queues and engines...");
// Dynamically import after AI config is ready to ensure @anycrawl/ai is initialized with config
const { EngineQueueManager, AVAILABLE_ENGINES } = await import("./managers/EngineQueue.js");
const engineQueueManager = EngineQueueManager.getInstance();
await engineQueueManager.initializeQueues();
await engineQueueManager.initializeEngines();

// Initialize QueueManager
QueueManager.getInstance();
log.info("All queues and engines initialized and started");

async function runJob(job: Job) {
    const engineType = job.data.engine || "cheerio";
    if (!ALLOWED_ENGINES.includes(engineType)) {
        throw new Error(`Unsupported engine type: ${engineType}`);
    }

    const jobType = job.data.type || JOB_TYPE_SCRAPE;
    log.info(`Processing ${jobType} job for URL: ${job.data.url} with engine: ${engineType}`);

    let options = job.data.options;
    // if jobType is crawl, transform options
    if (jobType === JOB_TYPE_CRAWL) {
        options = { ...job.data.options.scrape_options };
    }
    const currentJobId = job.id as string;
    const uniqueKey = await engineQueueManager.addRequest(engineType, job.data.url,
        {
            jobId: currentJobId,
            queueName: job.data.queueName,
            type: jobType,
            options: options || {},
            crawl_options: jobType === JOB_TYPE_CRAWL ? job.data.options : null,
        }
    );
    // Seed enqueued counter for crawl jobs (the initial URL itself)
    if (jobType === JOB_TYPE_CRAWL) {
        await ProgressManager.getInstance().incrementEnqueued(currentJobId, 1);
    }
    job.updateData({
        ...job.data,
        uniqueKey,
        status: "processing",
    });
}

// Initialize the application
(async () => {
    try {
        // check redis
        const redisClient = Utils.getInstance().getRedisConnection();
        await redisClient.ping();
        log.info("Redis connection established");
        // Start the worker to handle new URLs
        log.info("Starting worker...");
        await Promise.all([
            // Workers for scrape jobs
            ...AVAILABLE_ENGINES.map((engineType: any) =>
                WorkerManager.getInstance().getWorker(`scrape-${engineType}`, async (job: Job) => {
                    job.updateData({
                        ...job.data,
                        type: JOB_TYPE_SCRAPE,
                    });
                    await runJob(job);
                })
            ),
            // Workers for crawl jobs
            ...AVAILABLE_ENGINES.map((engineType: any) =>
                WorkerManager.getInstance().getWorker(`crawl-${engineType}`, async (job: Job) => {
                    job.updateData({
                        ...job.data,
                        type: JOB_TYPE_CRAWL,
                    });
                    await runJob(job);
                }),
            )
        ]);

        log.info("Worker started successfully");

        // Check queue status periodically for all engines
        setInterval(async () => {
            for (const engineType of AVAILABLE_ENGINES) {
                try {
                    const queueInfo = await engineQueueManager.getQueueInfo(engineType);
                    if (queueInfo) {
                        log.info(
                            `Queue status for ${engineType} - requests: ${queueInfo.pendingRequestCount}, handled: ${queueInfo.handledRequestCount}`
                        );
                    }
                } catch (error) {
                    log.error(`Error checking queue status for ${engineType}: ${error}`);
                }
            }
        }, 3000); // Check every 3 seconds

        // Handle graceful shutdown
        process.on("SIGINT", async () => {
            log.warning("Received SIGINT signal, stopping all crawlers...");
            // Temporarily disable console.warn to prevent the pause message
            const originalWarn = console.warn;
            console.warn = () => { };

            // Stop all engines
            await engineQueueManager.stopEngines();

            // Restore console.warn
            console.warn = originalWarn;

            process.exit(0);
        });

        // Keep the process running
        process.stdin.resume();
    } catch (error) {
        log.error(`Failed to start scraping worker: ${error}`);
        process.exit(1);
    }
})();
await engineQueueManager.startEngines();
