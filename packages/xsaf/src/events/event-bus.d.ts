import type { EventHandler, EventType, HumanApprovalHandler, XsafEvent } from "../types";
export declare class EventBus {
  #private;
  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): () => void;
  approve(handler: HumanApprovalHandler): () => void;
  requestApproval(
    input: unknown,
    context: {
      readonly tool: string;
      readonly sessionId: string;
    },
  ): Promise<boolean>;
  emit(event: XsafEvent): Promise<unknown[]>;
}
