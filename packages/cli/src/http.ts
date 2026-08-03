import type {
  AgentResult,
  EventFor,
  EventHandler,
  EventType,
  InvokeResult,
  TuiAgent,
  XsafEvent,
} from "./protocol";

export interface HttpAgentOptions {
  readonly url: string;
  readonly apiKey?: string;
  readonly name?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

type SseMessage = {
  readonly event: string;
  readonly data: string;
};

const eventTypes = new Set<EventType>([
  "tool.called",
  "tool.completed",
  "tool.failed",
  "delegate.started",
  "delegate.completed",
]);

async function* decodeSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        let event = "message";
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trimStart();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) yield { event, data: data.join("\n") };
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function messageFrom(data: string): string {
  try {
    const parsed = JSON.parse(data) as { readonly message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : "Agent request failed";
  } catch {
    return "Agent request failed";
  }
}

class HttpAgent implements TuiAgent {
  readonly name: string;
  readonly #options: HttpAgentOptions;
  readonly #handlers = new Map<EventType, Set<(event: XsafEvent) => void | Promise<void>>>();
  readonly #controllers = new Set<AbortController>();

  constructor(options: HttpAgentOptions) {
    this.#options = options;
    this.name = options.name ?? "xsaf";
  }

  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): () => void {
    const handlers = this.#handlers.get(type) ?? new Set();
    const erased = handler as (event: XsafEvent) => void | Promise<void>;
    handlers.add(erased);
    this.#handlers.set(type, handlers);
    return () => handlers.delete(erased);
  }

  async invoke(prompt: string, sessionId = "tui"): Promise<InvokeResult> {
    const controller = new AbortController();
    this.#controllers.add(controller);
    const endpoint = new URL(this.#options.path ?? "/chat", this.#options.url);
    const headers = new Headers(this.#options.headers);
    headers.set("accept", "text/event-stream");
    headers.set("content-type", "application/json");
    if (this.#options.apiKey) headers.set("authorization", `Bearer ${this.#options.apiKey}`);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: prompt, sessionId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).trim();
        let detail = body;
        try {
          const parsed = JSON.parse(body) as { readonly error?: unknown };
          if (typeof parsed.error === "string") detail = parsed.error;
        } catch {
          // Keep the plain response body.
        }
        throw new Error(detail || `Agent request failed with HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Agent response did not include a stream");
    } catch (error) {
      this.#controllers.delete(controller);
      throw error;
    }

    let resolveCompleted: ((result: AgentResult) => void) | undefined;
    let rejectCompleted: ((error: unknown) => void) | undefined;
    const completed = new Promise<AgentResult>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    void completed.catch(() => undefined);

    const self = this;
    const textStream = (async function* () {
      let text = "";
      try {
        for await (const message of decodeSse(response.body!)) {
          if (message.event === "message.delta") {
            const data = JSON.parse(message.data) as { readonly text?: unknown };
            if (typeof data.text === "string") {
              text += data.text;
              yield data.text;
            }
            continue;
          }
          if (message.event === "error") throw new Error(messageFrom(message.data));
          if (eventTypes.has(message.event as EventType)) {
            const event = JSON.parse(message.data) as XsafEvent;
            await self.#emit(event.type, event as EventFor<typeof event.type>);
          }
        }
        resolveCompleted?.({ text });
      } catch (error) {
        rejectCompleted?.(error);
        throw error;
      } finally {
        self.#controllers.delete(controller);
      }
    })();

    return { textStream, completed };
  }

  close(): void {
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }

  async #emit<Type extends EventType>(type: Type, event: EventFor<Type>): Promise<void> {
    const handlers = [...(this.#handlers.get(type) ?? [])];
    await Promise.allSettled(handlers.map((handler) => handler(event)));
  }
}

export default function httpAgent(options: HttpAgentOptions): TuiAgent {
  return new HttpAgent(options);
}
