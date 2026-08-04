import { requestApproval } from "chat/workflow";
import type { Thread } from "chat";

export async function requestToolApproval(opts: {
  thread: Thread;
  tool: string;
  input: unknown;
}): Promise<{ approved: boolean }> {
  "use workflow";

  const { approved } = await requestApproval(opts.thread, {
    title: `Approve ${opts.tool}?`,
    fields: { Input: JSON.stringify(opts.input) },
  });

  return { approved };
}
