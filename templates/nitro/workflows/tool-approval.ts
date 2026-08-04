import { requestApproval } from "chat/workflow";
import type { Thread } from "chat";

function log(stage: string, detail?: Record<string, unknown>) {
  console.log("[xsaf:approval:workflow]", stage, detail ?? "");
}

/** Docs pattern: https://chat-sdk.dev/docs/approvals */
export async function requestToolApproval(opts: {
  thread: Thread;
  tool: string;
  input: unknown;
}): Promise<{ approved: boolean }> {
  "use workflow";

  log("enter", {
    tool: opts.tool,
    threadId: opts.thread?.id,
    hasThread: Boolean(opts.thread),
  });

  try {
    log("requestApproval:before", { tool: opts.tool });
    const result = await requestApproval(opts.thread, {
      title: `Approve ${opts.tool}?`,
      fields: { Input: JSON.stringify(opts.input) },
    });
    log("requestApproval:after", {
      approved: result.approved,
      timedOut: result.timedOut,
      userId: result.user?.id,
    });
    return { approved: result.approved };
  } catch (error) {
    log("requestApproval:error", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
