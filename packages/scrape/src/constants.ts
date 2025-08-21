// Lightweight constants shared by API/docs. No heavy imports here.

export const ALLOWED_ENGINES = ["playwright", "cheerio", "puppeteer"] as const;

export const SCRAPE_FORMATS = [
    "markdown",
    "html",
    "text",
    "screenshot",
    "screenshot@fullPage",
    "rawHtml",
    "json",
] as const;

// Job type constants (avoid importing BaseEngine early)
export const JOB_TYPE_SCRAPE = 'scrape' as const;
export const JOB_TYPE_CRAWL = 'crawl' as const;
