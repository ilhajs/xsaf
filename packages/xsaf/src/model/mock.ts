import type { ModelRequest, ModelResponse, XsafModel, XsafModelAdapter } from "../types";

export type MockModelResponder = (request: ModelRequest) => ModelResponse | Promise<ModelResponse>;

export interface MockModelOptions {
  readonly name?: string;
  readonly response?: string | ModelResponse | MockModelResponder;
}

export interface MockModel extends XsafModel {
  readonly requests: readonly ModelRequest[];
}

class MockAdapter implements XsafModelAdapter {
  readonly requests: ModelRequest[] = [];
  readonly #response: string | ModelResponse | MockModelResponder;

  constructor(options: MockModelOptions) {
    this.#response = options.response ?? "Mock response";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response =
      typeof this.#response === "function" ? await this.#response(request) : this.#response;
    return typeof response === "string" ? { text: response } : response;
  }
}

/** Deterministic configured model for examples and tests. It never performs I/O. */
export default function mockModel(options: MockModelOptions = {}): MockModel {
  const adapter = new MockAdapter(options);
  return {
    name: options.name ?? "mock/model",
    adapter,
    requests: adapter.requests,
  };
}
