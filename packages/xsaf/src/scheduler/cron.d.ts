import type { ScheduleConfig, ScheduledTask, XsafSchedulerDriver } from "../types";
export interface ParsedCron {
  readonly fields: readonly Set<number>[];
  matches(date: Date, timezone: string): boolean;
}
export declare function parseCron(expression: string): ParsedCron;
export declare class CronScheduler implements XsafSchedulerDriver {
  schedule(config: ScheduleConfig, run: () => Promise<void>): Promise<ScheduledTask>;
}
