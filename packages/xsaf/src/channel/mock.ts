import type {
  ChannelContext,
  ChannelPayload,
  ChannelTarget,
  InboundMessage,
  XsafChannelDriver,
} from "../types";

export interface MockSentMessage {
  readonly target: ChannelTarget;
  readonly payload: ChannelPayload;
}

export class MockChannel implements XsafChannelDriver {
  readonly name: string;
  readonly sent: MockSentMessage[] = [];
  #context: ChannelContext | undefined;
  #closed = false;

  constructor(name = "mock") {
    this.name = name;
  }

  listen(context: ChannelContext): void {
    if (this.#closed) throw new Error("Mock channel is closed");
    this.#context = context;
  }

  async send(target: ChannelTarget, payload: ChannelPayload): Promise<void> {
    if (this.#closed) throw new Error("Mock channel is closed");
    this.sent.push({ target, payload });
  }

  async receive(message: InboundMessage): Promise<void> {
    if (!this.#context) throw new Error("Mock channel is not listening");
    await this.#context.dispatch(message);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#context = undefined;
  }
}

export default function mock(name?: string): MockChannel {
  return new MockChannel(name);
}
