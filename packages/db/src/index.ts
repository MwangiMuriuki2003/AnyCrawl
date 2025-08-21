import { eq, and, gt, gte, sql } from "drizzle-orm";
import { getDB, schemas } from "./db/index.js";
import { STATUS } from "./map.js";
import { Job, CreateJobParams } from "./model/Job.js";

// Backward compatibility functions
export const createJob = Job.create;
export const getJob = Job.get;
export const cancelJob = Job.cancel;
export const updateJobStatus = Job.updateStatus;
export const failedJob = Job.markAsFailed;
export const completedJob = Job.markAsCompleted;
export const insertJobResult = Job.insertJobResult;
export const getJobResults = Job.getJobResults;
export const getJobResultsPaginated = Job.getJobResultsPaginated;
export const getJobResultsCount = Job.getJobResultsCount;

export { eq, and, gt, gte, sql, getDB, schemas, STATUS, Job };
export type { CreateJobParams };