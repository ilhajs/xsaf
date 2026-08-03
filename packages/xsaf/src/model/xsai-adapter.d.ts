import type { StandardSchemaV1 } from "../standard-schema";
import type { ModelRequest, ModelResponse, ModelStreamResponse, XsafModelAdapter } from "../types";
export declare class XsaiModelAdapter implements XsafModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): ModelStreamResponse;
  ask<Output>(request: ModelRequest, schema: StandardSchemaV1<unknown, Output>): Promise<Output>;
}
