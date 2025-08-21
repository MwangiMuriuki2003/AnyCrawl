import { Response, NextFunction } from "express";
import { RequestWithAuth } from "../types/Types.js";
import { log } from "@anycrawl/libs/log";
import { getDB, schemas, eq } from "@anycrawl/db";

export const checkCreditsMiddleware = async (
    req: RequestWithAuth,
    res: Response,
    next: NextFunction
): Promise<void> => {
    // Skip if auth is disabled or credits deduction is disabled.
    if (process.env.ANYCRAWL_API_AUTH_ENABLED !== "true" || process.env.ANYCRAWL_API_CREDITS_ENABLED !== "true") {
        next();
        return;
    }
    req.checkCredits = true;

    try {
        const userUuid = req.auth?.uuid;
        if (!req.auth) {
            res.status(401).json({
                success: false,
                error: "Authentication required",
            });
            return;
        }

        // Get current credits from database in real-time
        const db = await getDB();
        const [user] = await db
            .select({ credits: schemas.apiKey.credits })
            .from(schemas.apiKey)
            .where(eq(schemas.apiKey.uuid, userUuid));

        if (!user) {
            res.status(404).json({
                success: false,
                error: "User not found",
            });
            return;
        }

        // Update auth object with latest credits
        if (req.auth) {
            req.auth.credits = user.credits;
        }

        // Check if user has any credits (allowing negative credits now)
        if (user.credits <= 0) {
            res.status(402).json({
                success: false,
                error: "Insufficient credits",
                current_credits: user.credits,
            });
            return;
        }

        next();
    } catch (error) {
        log.error(`Error checking credits: ${error}`);
        res.status(500).json({
            success: false,
            error: "Internal server error",
        });
        return;
    }
};
