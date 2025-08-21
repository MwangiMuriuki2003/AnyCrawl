import { RequestQueueV2, LaunchContext, Dictionary, log } from "crawlee";
import type { EngineOptions } from "./Base.js";
import proxyConfiguration from "../managers/Proxy.js";

// Use type-only reference to avoid runtime import of Base and engines
export type Engine = import("./Base.js").BaseEngine;

// Base factory interface
export interface IEngineFactory {
    createEngine(queue: RequestQueueV2, options?: EngineOptions): Promise<Engine>;
}

// Default configurations
const defaultOptions: EngineOptions = {
    requestHandlerTimeoutSecs: 60,
    keepAlive: process.env.ANYCRAWL_KEEP_ALIVE === "false" ? false : true,
    proxyConfiguration: proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: false
};

if (process.env.ANYCRAWL_MIN_CONCURRENCY) {
    defaultOptions.minConcurrency = parseInt(process.env.ANYCRAWL_MIN_CONCURRENCY);
}
if (process.env.ANYCRAWL_MAX_CONCURRENCY) {
    defaultOptions.maxConcurrency = parseInt(process.env.ANYCRAWL_MAX_CONCURRENCY);
}

const defaultLaunchContext: Partial<LaunchContext> = {
    launchOptions: {
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-gpu",
            ...(process.env.ANYCRAWL_IGNORE_SSL_ERROR === "true"
                ? ["--ignore-certificate-errors", "--ignore-certificate-errors-spki-list"]
                : []),
        ],
        defaultViewport: {
            width: 1920,
            height: 1080
        },
        ignoreHTTPSErrors: process.env.ANYCRAWL_IGNORE_SSL_ERROR === "true" ? true : false,
    },
    // Add user agent if set
    ...(process.env.ANYCRAWL_USER_AGENT ? {
        userAgent: process.env.ANYCRAWL_USER_AGENT
    } : {}),
};

const defaultHttpOptions: Record<string, any> = {
    ignoreSslErrors: process.env.ANYCRAWL_IGNORE_SSL_ERROR === "true" ? true : false,
};

// Concrete factory implementations
export class CheerioEngineFactory implements IEngineFactory {
    async createEngine(queue: RequestQueueV2, options?: EngineOptions): Promise<Engine> {
        const mod = await import("./Cheerio.js");
        const { CheerioEngine } = mod as any;
        return new CheerioEngine({
            ...defaultOptions,
            requestQueue: queue,
            additionalMimeTypes: ["text/html", "text/plain", "application/xhtml+xml"],
            ...defaultHttpOptions,
            ...options,
        });
    }
}

export class PlaywrightEngineFactory implements IEngineFactory {
    async createEngine(queue: RequestQueueV2, options?: EngineOptions): Promise<Engine> {
        const mod = await import("./Playwright.js");
        const { PlaywrightEngine } = mod as any;
        return new PlaywrightEngine({
            ...defaultOptions,
            requestQueue: queue,
            launchContext: defaultLaunchContext,
            ...options,
        });
    }
}

export class PuppeteerEngineFactory implements IEngineFactory {
    async createEngine(queue: RequestQueueV2, options?: EngineOptions): Promise<Engine> {
        const mod = await import("./Puppeteer.js");
        const { PuppeteerEngine } = mod as any;
        return new PuppeteerEngine({
            ...defaultOptions,
            requestQueue: queue,
            launchContext: defaultLaunchContext,
            ...options,
        });
    }
}

// Factory registry and main factory
export class EngineFactoryRegistry {
    private static factories = new Map<string, IEngineFactory>();

    static {
        // Register default factories
        this.register('cheerio', new CheerioEngineFactory());
        this.register('playwright', new PlaywrightEngineFactory());
        this.register('puppeteer', new PuppeteerEngineFactory());
    }

    static register(engineType: string, factory: IEngineFactory): void {
        this.factories.set(engineType, factory);
    }

    static async createEngine(
        engineType: string,
        queue: RequestQueueV2,
        options?: EngineOptions
    ): Promise<Engine> {
        const factory = this.factories.get(engineType);
        if (!factory) {
            throw new Error(`No factory registered for engine type: ${engineType}`);
        }
        return factory.createEngine(queue, options);
    }

    static getRegisteredEngineTypes(): string[] {
        return Array.from(this.factories.keys());
    }
} 