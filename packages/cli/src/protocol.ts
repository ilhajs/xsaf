export interface AgentResult {
  readonly text: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

export type InvokeResult =
  | AgentResult
  | {
      readonly textStream: AsyncIterable<string>;
      readonly completed: Promise<AgentResult>;
    };

export type XsafEvent =
  | {
      readonly type: "tool.called";
      readonly tool: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "tool.completed";
      readonly tool: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "tool.failed";
      readonly tool: string;
      readonly sessionId: string;
      readonly error: string;
    }
  | {
      readonly type: "delegate.started";
      readonly delegate: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "delegate.completed";
      readonly delegate: string;
      readonly sessionId: string;
    };

export type EventType = XsafEvent["type"];
export type EventFor<Type extends EventType> = Extract<XsafEvent, { readonly type: Type }>;
export type EventHandler<Type extends EventType> = (event: EventFor<Type>) => void | Promise<void>;

export interface TuiAgent {
  readonly name?: string;
  invoke(prompt: string, sessionId?: string): Promise<InvokeResult>;
  on<Type extends EventType>(type: Type, handler: EventHandler<Type>): unknown;
  close?(): void | Promise<void>;
}
