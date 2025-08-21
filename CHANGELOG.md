# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1-beta.1] - 2025-08-16

### Added

- Comprehensive job management system with job creation, status tracking, and results handling
- LLM-powered JSON schema extraction capabilities with enhanced extraction prompts
- ai-sdk framework with support for OpenRouter, OpenAI, and OpenAI-compatible providers
- ProgressManager for real-time crawl job progress monitoring
- Added crawl API endpoints with job management

### Changed

- Extracted database logic from API package into new `@anycrawl/db` package for better separation of concerns
- Updated zod to version 3.25.76 across all packages for improved type safety
- Refactored database access patterns to use the new dedicated database package
- Refactored job completion and failure logic with improved error handling and status updates
- Enhanced ALL-in-ONE Dockerfile and API Dockerfile for better deployment experience
- Reorganized documentation structure with improved meta.json organization and proxy rule documentation
- Enhanced proxy configuration loading with support for both file and HTTP URL sources

### Fixed

- Enhanced proxy selection logic for improved fallback handling

## [0.0.1-alpha.8] - 2025-07-04

### Added

- Advanced proxy configuration options including URL-based routing and tiered proxy management
- Multi-architecture Docker build support for ALL-IN-ONE with architecture detection and GitHub Actions workflow for automated image building and pushing
- AI provider management module with configuration, model mapping, and cost tracking features
- LLMExtract agent for structured-data extraction with enhanced model interaction capabilities (next version will support etraction in scrape)
- Performance testing script with K6 for load testing with metrics and scenarios
- Fingerprinting options for Puppeteer and Playwright configurations for using newer version Chrome
- Enhanced Docker documentation with quick start guide and Arm64 architecture support

### Changed

- Enhanced HTML to Markdown conversion with custom rules for whitespace, divs, spans, emphasis, and line breaks
- Improved scraping functionality with enhanced error handling and refined response structure
- Updated project configuration and dependencies, including knip configuration and improved dependency management
- Refactored proxy configuration by extending Crawlee's ProxyConfiguration for simplified management
- Improved null safety in DataExtractor by using optional chaining for userData properties
- Updated scripts for improved development workflow with type checking

### Fixed

- Improved error logging in EngineConfigurator for better debugging
- Enhanced icon rendering logic to handle undefined cases and ensure proper component type handling
- Improved helper function getEnabledModelIdByModelKey for better reliability
- Handle 403 Forbidden responses in BaseEngine to improve error management
- Fixed Docker image tagging logic in GitHub Actions workflows

## [0.0.1-alpha.7] - 2025-06-17

### Added

- Created separate public router for public endpoints like file serving, improving API organization

### Changed

- Significantly enhanced `HTMLTransformer` with automatic relative URL transformation for images, links, and other resources
- Enhanced `srcset` attribute handling for responsive images with size and pixel density parsing
- Improved anchor href transformation with robust URL resolution
- Refactored API routing architecture by splitting routes into dedicated modules for better separation of concerns
- Enhanced `DataExtractor` with new `TransformOptions` interface supporting base URL specification and URL transformation toggles
- Updated screenshot path handling in `ScrapeController` for improved organization and clarity

## [0.0.1-alpha.6] - 2025-06-15

### Changed

- Improved flexibility in S3 integration.

### Fixed

- Streamlined job payload structure in `ScrapeController` by transforming validated request data.
- Updated `ScrapeSchema` to encapsulate options within a single object for improved clarity and maintainability.

## [0.0.1-alpha.5] - 2025-06-14

### Added

- Integrated AWS S3 storage support with new `S3` class and environment variables for seamless file uploads and retrievals.
- Introduced `FileController` for serving files from S3 or local storage with robust path validation and error handling.
- Added multiple content transformers (Screenshot, `HTMLTransformer`) improving HTML/Markdown extraction and screenshot generation.
- Extended scraping capabilities with new options: output `formats`, `timeout`, tag filtering, `wait_for`, retry strategy, viewport configuration, and custom user-agent support.
- Added Safe Search parameter to `SearchSchema` for filtered search results.
- Refactored engine architecture with a factory pattern and new core modules for configuration validation, data extraction, and job management.
- Implemented graceful shutdown handling for the API server and improved logging for uncaught exceptions / unhandled rejections.
- Added Jest configuration for API and library packages with ESM support and updated test scripts.
- Updated CI workflows to publish Docker images on version tags.
- Expanded README with detailed environment variable descriptions and API usage examples.

### Changed

- Refined error handling in `ScrapeController` and `JobManager`; failure responses now include structured error objects and HTTP status codes.
- Enhanced `BaseEngine` with explicit HTTP error checks and resilience improvements.
- Updated OpenAPI documentation to reflect new scraping parameters and error formats.
- Migrated key-value store name to environment configuration for greater flexibility.
- Enhanced per-request credit tracking in `ScrapeController` and enhanced logging middleware to include credit usage.

### Fixed

- Improved job failure messages to include detailed error data, ensuring clearer debugging information.
- Minor documentation corrections and clarifications.

## [0.0.1-alpha.4] - 2025-05-26

### Changed

- Modified parameters of engines.

### Fixed

- Fixed Dockerfile.puppeteer errors.

## [0.0.1-alpha.3] - 2025-05-25

### Added

- Added comprehensive OpenAPI documentation generation with automated API endpoint documentation
- Added credits system with real-time credit tracking and management
- Added `DeductCreditsMiddleware` for automatic credit deduction on successful API requests
- Added new database fields for user tracking and enhanced request logging, and dropped some columns.
- Added Docker deployment guide and documentation

### Changed

- Enhanced error handling in `ScrapeController` to return structured error messages array
- Updated `SearchSchema` to enforce minimum (1) and maximum (20) values for pages parameter
- Refactored `CheckCreditsMiddleware` to fetch user credits from database in real-time
- Updated PostgreSQL and SQLite schemas for `api_key` and `request_log` tables with new user field
- Enhanced logging middleware to capture additional request details including response body
- Updated README with usage instructions and documentation links
- Improved credit deduction logic to allow negative credits and atomic updates
- Enhanced API endpoints with structured responses and better validation
- Imporved request logging middleware to capture detailed request/response information

### Fixed

- Fixed database schema consistency between PostgreSQL and SQLite
- Improved error handling and logging across API controllers

## [0.0.1-alpha.2] - 2025-05-15

### Added

- Added proxy support to scraping configuration
- Added ANYCRAWL_KEEPALIVE option for engine keep-alive functionality

### Changed

- Updated Dockerfiles for Cheerio, Playwright, and Puppeteer services
- Improved Docker environment variables configuration
- Modified Docker permissions and directory ownership settings
- Updated .env.example and docker-compose.yml to use ANYCRAWL_REDIS_URL

### Fixed

- Fixed Docker permissions issues for scraping services
- Fixed database migration issues

## [0.0.1-alpha.1] - 2025-05-13

### Added

- Initial project setup with a monorepo structure using pnpm workspaces
- Docker support for easy deployment and environment consistency
    - Provided `Dockerfile` and `docker-compose.yml`
- Node.js environment requirements (>=18)
- Package management with pnpm 10.10.0
- Core web crawling functionality:
    - Single page content extraction
    - Multi-threading and multi-process architecture for high performance
- SERP (Search Engine Results Page) crawling:
    - Support for Google search engine
    - Batch processing (multiple pages per request)
- Development environment setup:
    - TypeScript configuration
    - Prettier code formatting
    - Turbo repo configuration for monorepo management
- Documentation:
    - Project overview and feature list in README
    - Contributing guidelines
    - MIT License

### Technical Details

- Built with Node.js and TypeScript
- Redis integration for caching and queue management
- JavaScript rendering support via Puppeteer and Playwright
- HTTP crawling via Cheerio

**This is the initial release.**
