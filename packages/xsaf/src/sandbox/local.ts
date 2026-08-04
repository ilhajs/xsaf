import type { SandboxPermissions, XsafSandboxDriver } from "../types";

/** Required acknowledgement that host-process execution provides no isolation. */
export interface UnsafeLocalOptions {
  readonly unsafe: true;
}

class UnsafeLocalSandbox implements XsafSandboxDriver {
  readonly name = "unsafe_local";
  readonly permissions: SandboxPermissions = {
    fs: false,
    network: false,
    shell: false,
  };

  async run(fn: (...args: unknown[]) => Promise<unknown>, args: unknown[]): Promise<unknown> {
    return fn(...args);
  }
}

/**
 * Explicitly runs tools in the current JavaScript host process without isolation.
 * Never use this adapter for untrusted tool code.
 *
 * Callers must pass `{ unsafe: true }` so opting out of isolation is deliberate.
 */
export default function local(options: UnsafeLocalOptions): XsafSandboxDriver {
  if (options?.unsafe !== true) {
    throw new TypeError(
      "@xsaf/agent/sandbox/local requires { unsafe: true } to acknowledge host-process execution with no isolation",
    );
  }
  return new UnsafeLocalSandbox();
}
