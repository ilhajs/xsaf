import { HostSandbox } from "./host";

/**
 * Explicitly opts tools into the current JavaScript host process.
 *
 * This provides no isolation and must not be used for untrusted tool code.
 * Prefer an AgentOS-compatible sandbox driver in production.
 */
export default function local(): HostSandbox {
  return new HostSandbox({
    allowUnsafeHostExecution: true,
    name: "local_no_isolation",
  });
}
