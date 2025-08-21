import { log } from "@anycrawl/libs"
import { htmlToMarkdown } from "@anycrawl/libs/html-to-markdown";
import { HTMLTransformer, ExtractionOptions, TransformOptions } from "./transformers/HTMLTransformer.js";
import type { CrawlingContext } from "../engines/Base.js";
import { ScreenshotTransformer } from "./transformers/ScreenshotTransformer.js";
import { convert } from "html-to-text"
import * as cheerio from "cheerio";
import { LLMExtract, getExtractModelId } from "@anycrawl/ai";

export interface MetadataEntry {
    name: string;
    content: string;
    property?: string;
}

export interface BaseContent {
    url: string;
    title: string;
    rawHtml: string;
    [key: string]: any;
}

export interface AdditionalFields {
    html?: string;
    markdown?: string;
    [key: string]: any;
}

export class ExtractionError extends Error {
    step: string;
    originalError?: Error;

    constructor(step: string, message: string, originalError?: Error) {
        super(message);
        this.name = 'ExtractionError';
        this.step = step;
        this.originalError = originalError;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ExtractionError);
        }
    }

    static fromError(step: string, error: Error): ExtractionError {
        return new ExtractionError(step, error.message, error);
    }
}

/**
 * Data extractor for crawling operations
 * Handles all data extraction and transformation logic
 */
export class DataExtractor {
    private htmlTransformer: HTMLTransformer;
    private screenshotTransformer: ScreenshotTransformer;
    private llmExtractMap: Map<string, LLMExtract> = new Map();

    constructor() {
        this.htmlTransformer = new HTMLTransformer();
        this.screenshotTransformer = new ScreenshotTransformer();
    }

    private getLLMExtractAgentKey(modelId: string): string {
        return `${modelId}`;
    }

    /**
     * Get LLM extract agent
     * @param modelId - The model id, like "gpt-4o-mini"
     * @returns LLM extract agent instance
     */
    getLLMExtractAgent(modelId: string): LLMExtract {
        const key = this.getLLMExtractAgentKey(modelId);
        if (!this.llmExtractMap.has(key)) {
            this.llmExtractMap.set(key, new LLMExtract(modelId));
        }
        return this.llmExtractMap.get(key)!;
    }

    /**
     * Convert text/HTML string to cheerio instance
     * @param text - The HTML or text string to convert
     * @param options - Optional cheerio load options
     * @returns Cheerio instance
     */
    convertTextToCheerio(text: string, options?: any): any {
        try {
            return cheerio.load(text, options);
        } catch (error) {
            log.error(`Failed to convert text to cheerio: ${error}`);
            throw new Error(`Failed to convert text to cheerio: ${error}`);
        }
    }

    /**
     * Get cheerio instance using unified approach
     */
    async getCheerioInstance(context: any): Promise<any> {
        let $ = null;
        try {
            if (context.parseWithCheerio) {
                // Playwright and Puppeteer have parseWithCheerio method
                $ = await context.parseWithCheerio();
            } else if (context.$ && context.$ !== undefined) {
                // CheerioEngine uses existing $ object
                $ = context.$;
            }
        } catch (error) {
            log.debug(`Failed to parse with cheerio: ${error}`);
        }

        if ($ === null || $ === undefined) {
            try {
                if (context.page && context.page.content && typeof context.page.content === "function") {
                    // Check if page is closed before trying to get content
                    if ((context.page as any).isClosed && (context.page as any).isClosed()) {
                        throw new Error("Page is closed");
                    }
                    const html = await context.page.content();
                    return this.convertTextToCheerio(html);
                } else if (context.body) {
                    return this.convertTextToCheerio(context.body.toString("utf-8"));
                } else {
                    return this.convertTextToCheerio("<!DOCTYPE html><html><head><title></title></head><body></body></html>");
                }
            } catch (error) {
                log.debug(`Failed to get page content: ${error}`);
                return this.convertTextToCheerio("<!DOCTYPE html><html><head><title></title></head><body></body></html>");
            }
        }
        return $;
    }

    /**
     * Extract base content (url, title, html) in a unified way
     */
    async extractBaseContent(context: any, $: any): Promise<BaseContent> {
        let rawHtml = "";
        try {
            if (context.body) {
                // body (Cheerio engine) is available
                rawHtml = context.body.toString("utf-8");
            } else if (context.page && context.page.content) {
                // page.content (browser engines) is available
                // Check if page is closed before trying to get content
                if ((context.page as any).isClosed && (context.page as any).isClosed()) {
                    throw new Error("Page is closed");
                }
                rawHtml = await context.page.content();
            } else if ($ && $ !== undefined) {
                // Fallback: try to get HTML from cheerio if available (Cheerio engine)
                rawHtml = $('html').length > 0 ? $('html').parent().html() || $.html() : '';
            }
        } catch (error) {
            log.debug(`Failed to extract raw HTML: ${error}`);
            rawHtml = "";
        }

        let title = "";
        try {
            title = $('title').text().trim();
        } catch (error) {
            title = "";
        }

        return {
            url: context.request.url,
            title,
            rawHtml,
        };
    }

    /**
     * Extract metadata from cheerio instance
     */
    extractMetadata($: any): MetadataEntry[] {
        const metadata: MetadataEntry[] = [];

        try {
            $("meta").each((_: number, element: any) => {
                const $el = $(element);
                const name = $el.attr("name");
                const property = $el.attr("property");
                const content = $el.attr("content");

                if ((name || property) && content) {
                    metadata.push({
                        name: name || property,
                        content: content.trim(),
                        property: property || undefined,
                    });
                }
            });
        } catch (error) {
            log.error(`Failed to extract metadata: ${error}`);
        }

        return metadata;
    }

    /**
     * Process HTML content to markdown
     */
    processMarkdown(html: string): string {
        return htmlToMarkdown(html);
    }

    /**
     * Assemble final data object
     */
    assembleData(context: any, baseContent: BaseContent, metadata: MetadataEntry[], additionalFields: AdditionalFields): any {
        // const jobId = context.request.userData?.jobId;
        const { url, title, rawHtml, ...baseAdditionalFields } = baseContent;
        const formats = context.request.userData?.options?.formats;

        return {
            // jobId: jobId,
            // url,
            title,
            ...(Array.isArray(formats) && formats.includes("rawHtml") ? { rawHtml } : {}),
            metadata,
            ...baseAdditionalFields,
            ...additionalFields,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Extract all data from context
     */
    async extractData(context: CrawlingContext): Promise<any> {
        try {
            const $ = await this.getCheerioInstance(context);
            const baseContent = await this.extractBaseContent(context, $);
            const metadata = this.extractMetadata($);
            const formats = context.request.userData?.options?.formats || [];
            const options = context.request.userData?.options || {};
            const additionalFields: AdditionalFields = {};

            // Prepare all format tasks for concurrent execution
            const formatTasks: Record<string, Promise<any>> = {};
            const transformOptions: TransformOptions = {
                includeTags: options.includeTags,
                excludeTags: options.excludeTags,
                baseUrl: context.request.url,
                transformRelativeUrls: true
            };
            const page = (context as any).page;

            // Only generate transformHtml once if needed
            let htmlPromise: Promise<string> | undefined = undefined;
            if (formats.includes("html") || formats.includes("markdown") || formats.includes("json")) {
                log.debug("[extractData] Start transformHtml (concurrent)");
                htmlPromise = this.htmlTransformer.transformHtml($, context.request.url, transformOptions)
                    .then(result => {
                        log.debug("[extractData] Finished transformHtml");
                        return result;
                    });
            }
            // html and markdown are concurrent, but markdown depends on htmlPromise
            if (formats.includes("html")) {
                formatTasks.html = htmlPromise!;
            }
            // json need markdown
            if (formats.includes("markdown") || formats.includes("json")) {
                formatTasks.markdown = htmlPromise!.then(html => {
                    log.debug("[extractData] Start processMarkdown (after html)");
                    const md = this.processMarkdown(html);
                    log.debug("[extractData] Finished processMarkdown");
                    return md;
                });
            }
            if (formats.includes("rawHtml")) {
                formatTasks.rawHtml = Promise.resolve(baseContent.rawHtml);
            }
            if (formats.includes("text")) {
                formatTasks.text = Promise.resolve(convert(baseContent.rawHtml));
            }
            // Screenshot task is also concurrent
            if (page && typeof context.saveSnapshot === 'function' && (formats.includes("screenshot") || formats.includes("screenshot@fullPage"))) {
                formatTasks.screenshot = (async () => {
                    log.debug("[extractData] Start screenshot capture (concurrent)");
                    const result = await this.screenshotTransformer.captureAndStoreScreenshot(context, page, formats);
                    log.debug("[extractData] Finished screenshot capture");
                    return result;
                })();
            }
            // json_options, need to extract data from markdown. and formats must include json
            // TODO: consider to extract data from HTML, combine with tag info may be better
            if (options.json_options && formats.includes("json")) {
                // Resolve extract model id via config-aware helper
                const modelId = getExtractModelId();
                log.info(`[extract] Resolved extract model: ${modelId}`);
                formatTasks.json = (async () => {
                    const markdown = await (formatTasks.markdown ?? Promise.resolve(baseContent.markdown));
                    const llmExtractAgent = this.getLLMExtractAgent(modelId);
                    const extractStart = Date.now();
                    const result = await llmExtractAgent.perform(markdown, options.json_options.schema ?? null, {
                        prompt: options.json_options.user_prompt ?? null,
                        schemaName: options.json_options.schema_name ?? null,
                        schemaDescription: options.json_options.schema_description ?? null,
                    });
                    const extractDuration = Date.now() - extractStart;
                    // Structured logging for token usage and tracing
                    const jobId = context.request.userData?.jobId ?? 'unknown';
                    const queueName = context.request.userData?.queueName ?? 'unknown';
                    const reqKey = (context.request as any).id || context.request.uniqueKey || 'unknown';
                    const tokens = result.tokens || { input: 0, output: 0, total: 0 };
                    const cost = typeof result.cost === 'number' ? result.cost : 0;

                    log.info(`[${queueName}] [${jobId}] [extract] model=${modelId} url=${context.request.url} reqKey=${reqKey} tokens(input=${tokens.input}, output=${tokens.output}, total=${tokens.total}) cost=$${cost.toFixed(6)} duration=${extractDuration}ms`);
                    // Print provider raw usage as comparison if available
                    const rawUsage = (result as any).usage ?? null;
                    if (rawUsage) {
                        try {
                            log.info(`[${queueName}] [${jobId}] [extract:raw-usage] ${JSON.stringify(rawUsage)}`);
                        } catch { }
                    }
                    return result.data;
                })();
            }
            // All format tasks are executed concurrently, dependencies are handled by Promise chains
            const formatKeys = Object.keys(formatTasks);
            const formatResults = await Promise.all(Object.values(formatTasks));
            formatKeys.forEach((key, idx) => {
                if (formats.includes(key)) {
                    additionalFields[key] = formatResults[idx];
                }
            });
            return this.assembleData(context, baseContent, metadata, additionalFields);
        } catch (error) {
            return this.handleExtractionError(context, error as Error);
        }
    }

    /**
     * Handle extraction errors
     */
    handleExtractionError(context: CrawlingContext, error: Error): never {
        const jobId = context.request.userData?.jobId ?? 'unknown';
        const queueName = context.request.userData?.queueName ?? 'unknown';

        log.error(
            `[${queueName}] [${jobId}] Extraction failed: ${error.message}`
        );

        // Always throw a typed ExtractionError so callers can distinguish
        throw ExtractionError.fromError('extractData', error);
    }
} 