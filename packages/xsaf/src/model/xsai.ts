import type { XsafModel } from "../types";
import { XsaiModelAdapter } from "./xsai-adapter";

export interface XsaiModelOptions {
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
}

/** Configures the built-in xsAI-backed model. */
export default function xsai(options: XsaiModelOptions): XsafModel {
  if (!options.model.trim()) throw new TypeError("Model name is required");
  if (!options.baseURL.trim()) throw new TypeError("Model baseURL is required");
  if (!options.apiKey.trim()) throw new TypeError("Model apiKey is required");
  return {
    name: options.model,
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    adapter: new XsaiModelAdapter(),
  };
}
