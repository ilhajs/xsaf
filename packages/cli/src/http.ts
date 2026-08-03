import { createORPCClient, type Client } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type {
  AgentResult,
  ChatEvent,
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

type ChatInput = {
  readonly text: string;
  readonly sessionId?: string;
};

type ChatClient = Client<
  Record<never, never>,
  ChatInput,
  AsyncIterator<ChatEvent, void, unknown>,
  unknown
>;

const eventTypes = new Set<EventType>([
  "tool.called",
  "tool.completed",
  "tool.failed",
  "delegate.started",
  "delegate.completed",
]);

class HttpAgent implements TuiAgent {
  readonly name: string;
  readonly #client: ChatClient;
  readonly #handlers = new Map<EventType, Set<(event: XsafEvent) => void | Promise<void>>>();
  readonly #controllers = new Set<AbortController>();

  constructor(options: HttpAgentOptions) {
    this.name = options.name ?? "xsaf";
    const headers = { ...options.headers };
    if (options.apiKey) headers["authorization"] = `Bearer ${options.apiKey}`;
    const link = new RPCLink({
      url: new URL(options.path ?? "/chat", options.url).toString(),
      headers,
    });
    this.#client = createORPCClient<ChatClient>(link);
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

    let iterator: AsyncIterator<ChatEvent, void, unknown>;
    try {
      iterator = await this.#client({ text: prompt, sessionId }, { signal: controller.signal });
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
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          const event = result.value;
          if (event.type === "message.delta") {
            text += event.text;
            yield event.text;
            continue;
          }
          if (eventTypes.has(event.type as EventType)) {
            const lifecycle = event as XsafEvent;
            await self.#emit(lifecycle.type, lifecycle as EventFor<typeof lifecycle.type>);
          }
        }
        resolveCompleted?.({ text });
      } catch (error) {
        rejectCompleted?.(error);
        throw error;
      } finally {
        self.#controllers.delete(controller);
        await iterator.return?.();
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
