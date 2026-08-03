import type { ScheduleConfig, ScheduledTask, XsafSchedulerDriver } from "../types";

const LIMITS = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

function parsePart(part: string, minimum: number, maximum: number): Set<number> {
  const values = new Set<number>();
  for (const item of part.split(",")) {
    const [range = "", stepText] = item.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${item}`);
    let start: number;
    let end: number;
    if (range === "*") {
      start = minimum;
      end = maximum;
    } else if (range.includes("-")) {
      const values = range.split("-").map(Number);
      start = values[0] ?? Number.NaN;
      end = values[1] ?? Number.NaN;
    } else {
      start = Number(range);
      end = start;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < minimum ||
      end > maximum ||
      start > end
    ) {
      throw new Error(`Invalid cron field: ${item}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export interface ParsedCron {
  readonly fields: readonly Set<number>[];
  matches(date: Date, timezone: string): boolean;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must contain exactly five fields");
  const fields = parts.map((part, index) => {
    const limit = LIMITS[index];
    if (!limit) throw new Error("Invalid cron field");
    return parsePart(part, limit[0], limit[1]);
  });

  return {
    fields,
    matches(date, timezone) {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        minute: "numeric",
        hour: "numeric",
        day: "numeric",
        month: "numeric",
        weekday: "short",
        hourCycle: "h23",
      });
      const parts = Object.fromEntries(
        formatter.formatToParts(date).map((part) => [part.type, part.value]),
      );
      const weekdays: Readonly<Record<string, number>> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const values = [
        Number(parts["minute"]),
        Number(parts["hour"]),
        Number(parts["day"]),
        Number(parts["month"]),
        weekdays[parts["weekday"] ?? ""],
      ];
      return fields.every((field, index) => {
        const value = values[index];
        return (
          value !== undefined && (field.has(value) || (index === 4 && value === 0 && field.has(7)))
        );
      });
    },
  };
}

export class CronScheduler implements XsafSchedulerDriver {
  async schedule(config: ScheduleConfig, run: () => Promise<void>): Promise<ScheduledTask> {
    const cron = parseCron(config.cron);
    const timezone = config.timezone ?? "UTC";
    // Eagerly ask Intl to validate the IANA timezone.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    let lastMinute = "";
    let running = false;
    const execute = async () => {
      if (running) return;
      running = true;
      try {
        await run();
      } finally {
        running = false;
      }
    };
    const check = () => {
      const now = new Date();
      const minute = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
      if (minute !== lastMinute && cron.matches(now, timezone)) {
        lastMinute = minute;
        void execute().catch(() => undefined);
      }
    };
    const timer = setInterval(check, 15_000);
    if (config.runImmediately) await execute();
    return {
      async close() {
        clearInterval(timer);
      },
    };
  }
}
