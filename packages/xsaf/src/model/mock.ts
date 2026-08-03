import type { ModelRequest, ModelResponse, XsafModelAdapter } from "../types";

export type MockModelResponder = (request: ModelRequest) => ModelResponse | Promise<ModelResponse>;

export interface MockModelOptions {
  readonly response?: string | ModelResponse | MockModelResponder;
}

/** Deterministic model adapter for examples and tests. It never performs I/O. */
export class MockModelAdapter implements XsafModelAdapter {
  readonly requests: ModelRequest[] = [];
  readonly #response: string | ModelResponse | MockModelResponder;

  constructor(options: MockModelOptions = {}) {
    this.#response = options.response ?? "Mock response";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response =
      typeof this.#response === "function" ? await this.#response(request) : this.#response;
    return typeof response === "string" ? { text: response } : response;
  }
}

export default function mockModel(options?: MockModelOptions): MockModelAdapter {
  return new MockModelAdapter(options);
}
