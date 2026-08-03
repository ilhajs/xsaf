import type { XsafSchedulerDriver } from "../types";
export interface ParsedCron {
  readonly fields: readonly Set<number>[];
  matches(date: Date, timezone: string): boolean;
}
export declare function parseCron(expression: string): ParsedCron;
export declare function cron(): XsafSchedulerDriver;
