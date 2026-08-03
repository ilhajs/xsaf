import type { SandboxPermissions, XsafSandboxDriver } from "../types";

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
 */
export default function local(): XsafSandboxDriver {
  return new UnsafeLocalSandbox();
}
