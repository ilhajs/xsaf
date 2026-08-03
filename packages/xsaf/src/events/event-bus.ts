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
  readonly #forwarders = new Map<EventBus, number>();

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

  forwardTo(target: EventBus): () => void {
    if (target === this) return () => undefined;
    this.#forwarders.set(target, (this.#forwarders.get(target) ?? 0) + 1);
    return () => {
      const remaining = (this.#forwarders.get(target) ?? 1) - 1;
      if (remaining === 0) this.#forwarders.delete(target);
      else this.#forwarders.set(target, remaining);
    };
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
    const forwarders = [...this.#forwarders.keys()].map((target) => target.emit(event));
    const settled = await Promise.allSettled([
      ...handlers.map((handler) => handler(event)),
      ...forwarders,
    ]);
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }
}
