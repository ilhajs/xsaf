import type { Storage } from "unstorage";
import type { XsafMemoryDriver } from "../types";

export interface UnstorageMemoryOptions {
  readonly dispose?: boolean;
}

export declare function unstorage(
  storage: Storage,
  options?: UnstorageMemoryOptions,
): XsafMemoryDriver;
