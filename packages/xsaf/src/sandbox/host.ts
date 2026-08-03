import type { SandboxPermissions, XsafSandboxDriver } from "../types";

export interface HostSandboxOptions {
  /** Must be true: this adapter runs directly in the host process and provides no isolation. */
  readonly allowUnsafeHostExecution: true;
  readonly name?: string;
}

export class HostSandbox implements XsafSandboxDriver {
  readonly name: string;
  readonly permissions: SandboxPermissions = {
    fs: false,
    network: false,
    shell: false,
  };

  constructor(options: HostSandboxOptions) {
    if (options.allowUnsafeHostExecution !== true) {
      throw new TypeError("Host execution requires allowUnsafeHostExecution: true");
    }
    this.name = options.name ?? "unsafe_host";
  }

  async run(fn: (...args: unknown[]) => Promise<unknown>, args: unknown[]): Promise<unknown> {
    return fn(...args);
  }
}

/** Explicit no-isolation adapter. Permission metadata is descriptive and is not enforced. */
export default function host(options: HostSandboxOptions): HostSandbox {
  return new HostSandbox(options);
}
