import type {
  EventHandler,
  EventType,
  HumanApprovalHandler,
  MaybePromise,
  XsafEvent,
} from "../types";

type ErasedHandler = (event: XsafEvent) => MaybePromise<unknown>;

export class EventBus {
  readonly #handlers = new Map<EventType, Set<ErasedHandler>>();
  readonly #approvers = new Set<HumanApprovalHandler>();

  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): () => void {
    let handlers = this.#handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(type, handlers);
    }
    const erased = handler as unknown as ErasedHandler;
    handlers.add(erased);
    return () => handlers?.delete(erased);
  }

  approve(handler: HumanApprovalHandler): () => void {
    this.#approvers.add(handler);
    return () => this.#approvers.delete(handler);
  }

  async requestApproval(
    input: unknown,
    context: { readonly tool: string; readonly sessionId: string },
  ): Promise<boolean> {
    const settled = await Promise.allSettled(
      [...this.#approvers].map((handler) => handler(input, context)),
    );
    return settled.some((result) => result.status === "fulfilled" && result.value === true);
  }

  async emit(event: XsafEvent): Promise<unknown[]> {
    const handlers = [...(this.#handlers.get(event.type) ?? [])];
    const settled = await Promise.allSettled(handlers.map((handler) => handler(event)));
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }
}
