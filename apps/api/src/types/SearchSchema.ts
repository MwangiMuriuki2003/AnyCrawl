import { z } from "zod";
import { SearchLocale } from "@anycrawl/search/engines/types";
import { AVAILABLE_SEARCH_ENGINES } from "@anycrawl/search/constants";

const searchSchema = z.object({
    engine: z.enum(AVAILABLE_SEARCH_ENGINES).optional(),
    query: z.string(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    pages: z.number().min(1).max(20).optional(),
    lang: z.custom<SearchLocale>().optional(),
    country: z.custom<SearchLocale>().optional(),
    safeSearch: z.number().min(0).max(2).nullable().optional(), // 0: off, 1: medium, 2: high, null: default (Google only)
});

export type SearchSchema = z.infer<typeof searchSchema>;
export { searchSchema };
