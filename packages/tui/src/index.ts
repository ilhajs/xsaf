import {
  type Component,
  Container,
  Editor,
  type EditorTheme,
  Key,
  Markdown,
  type MarkdownTheme,
  matchesKey,
  ProcessTerminal,
  Spacer,
  Text,
  type Terminal,
  TUI,
  // pi-lens-ignore: ts:2307
} from "@earendil-works/pi-tui";
// pi-lens-ignore: ts:2307
import type { InvokeResult, XsafBuilder, XsafEvent } from "@xsaf/agent";

export interface XsafTuiTheme {
  readonly accent: (text: string) => string;
  readonly success: (text: string) => string;
  readonly warning: (text: string) => string;
  readonly danger: (text: string) => string;
  readonly bold: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly editor: EditorTheme;
  readonly markdown: MarkdownTheme;
}

export interface XsafTuiOptions {
  readonly agent: Pick<XsafBuilder, "name" | "invoke" | "on">;
  readonly sessionId?: string;
  readonly terminal?: Terminal;
  readonly theme?: XsafTuiTheme;
  readonly onExit?: () => void | Promise<void>;
}

const ansi = (open: number, close: number) => (text: string) =>
  `\u001b[${open}m${text}\u001b[${close}m`;

export function defaultTheme(): XsafTuiTheme {
  const accent = ansi(36, 39);
  const success = ansi(32, 39);
  const warning = ansi(33, 39);
  const danger = ansi(31, 39);
  const bold = ansi(1, 22);
  const dim = ansi(2, 22);
  const italic = ansi(3, 23);
  const underline = ansi(4, 24);
  const strikethrough = ansi(9, 29);

  return {
    accent,
    success,
    warning,
    danger,
    bold,
    dim,
    editor: {
      borderColor: accent,
      selectList: {
        selectedPrefix: accent,
        selectedText: bold,
        description: dim,
        scrollInfo: dim,
        noMatch: dim,
      },
    },
    markdown: {
      heading: (text: string) => bold(accent(text)),
      link: accent,
      linkUrl: dim,
      code: warning,
      codeBlock: success,
      codeBlockBorder: dim,
      quote: italic,
      quoteBorder: dim,
      hr: dim,
      listBullet: accent,
      bold,
      italic,
      strikethrough,
      underline,
    },
  };
}

export class XsafTui {
  readonly tui: TUI;
  readonly editor: Editor;

  readonly #options: Required<Pick<XsafTuiOptions, "sessionId">> & XsafTuiOptions;
  readonly #agentName: string;
  readonly #theme: XsafTuiTheme;
  readonly #messages = new Container();
  readonly #activity = new Map<string, Text>();
  readonly #maxHistoryItems = 200;
  #busy = false;
  #started = false;
  #stopping?: Promise<void>;

  constructor(options: XsafTuiOptions) {
    this.#options = {
      ...options,
      sessionId: options.sessionId ?? "tui",
    };
    if (!options.agent.name)
      throw new TypeError("@xsaf/tui requires an agent configured with a name");
    this.#agentName = options.agent.name;
    this.#theme = options.theme ?? defaultTheme();
    this.tui = new TUI(options.terminal ?? new ProcessTerminal());
    this.editor = new Editor(this.tui, this.#theme.editor, { paddingX: 1 });
    this.editor.onSubmit = (value: string) => void this.submit(value);

    this.tui.addChild(new Text(this.#agentName, 1, 1));
    this.tui.addChild(this.#messages);
    this.tui.addChild(this.editor);
    this.tui.setFocus(this.editor);
    this.tui.addInputListener((data: string) => {
      if (matchesKey(data, Key.ctrl("c"))) {
        void this.stop();
        return { consume: true };
      }
      return undefined;
    });

    this.#observeAgent();
  }

  start(): this {
    if (this.#stopping) throw new Error("Cannot restart a stopped XSAF TUI");
    if (!this.#started) {
      this.#started = true;
      this.tui.start();
    }
    return this;
  }

  async stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    this.#stopping = (async () => {
      if (this.#started) this.tui.stop();
      this.#started = false;
      await this.#options.onExit?.();
    })();
    return this.#stopping;
  }

  async submit(value: string): Promise<void> {
    const prompt = value.trim();
    if (!prompt || this.#busy) return;

    this.#busy = true;
    this.editor.disableSubmit = true;
    this.editor.borderColor = this.#theme.dim;
    this.editor.addToHistory(prompt);
    this.editor.setText("");
    this.addMessage("You", prompt);

    const thinking = new Text(this.#theme.dim("◇ Thinking…"), 1, 0);
    this.#append(thinking);
    this.tui.requestRender();

    try {
      const result = await this.#options.agent.invoke(prompt, this.#options.sessionId);
      this.#messages.removeChild(thinking);
      await this.#addAssistantResult(result);
      this.#append(new Spacer(1));
    } catch (error) {
      this.#messages.removeChild(thinking);
      this.addMessage("Error", error instanceof Error ? error.message : String(error));
      this.#append(new Spacer(1));
    } finally {
      this.#busy = false;
      this.editor.disableSubmit = false;
      this.editor.borderColor = this.#theme.accent;
      this.tui.requestRender();
    }
  }

  addMessage(author: string, markdown: string): Markdown {
    const message = new Markdown(`**${author}**\n\n${markdown}`, 1, 1, this.#theme.markdown);
    this.#append(message);
    this.tui.requestRender();
    return message;
  }

  addToolResult(tool: string, result: unknown): void {
    const value =
      typeof result === "string"
        ? result
        : `\`\`\`json\n${JSON.stringify(result, null, 2) ?? "null"}\n\`\`\``;
    this.addMessage(`Tool · ${tool}`, value || "Completed");
  }

  setStatus(key: string, label: string, state: "running" | "success" | "error"): void {
    const icon = state === "running" ? "◇" : state === "success" ? "✓" : "✗";
    const color =
      state === "running"
        ? this.#theme.dim
        : state === "success"
          ? this.#theme.success
          : this.#theme.danger;
    const text = `${icon} ${label}`;
    const component = this.#activity.get(key);
    if (component) component.setText(color(text));
    else {
      const status = new Text(color(text), 1, 0);
      this.#activity.set(key, status);
      this.#append(status);
    }
    this.tui.requestRender();
  }

  async #addAssistantResult(result: InvokeResult): Promise<void> {
    if ("text" in result) {
      this.addMessage(this.#agentName, result.text);
      return;
    }

    const streaming = new Text("", 1, 1);
    this.#append(streaming);
    let text = "";
    let lastRender = 0;
    for await (const chunk of result.textStream) {
      text += chunk;
      const now = Date.now();
      if (now - lastRender < 50) continue;
      lastRender = now;
      streaming.setText(`${this.#agentName}\n\n${text}`);
      this.tui.requestRender();
    }
    await result.completed;
    this.#messages.removeChild(streaming);
    this.addMessage(this.#agentName, text);
  }

  #append(component: Component): void {
    this.#messages.addChild(component);
    while (this.#messages.children.length > this.#maxHistoryItems) {
      const oldest = this.#messages.children[0];
      if (!oldest) break;
      this.#messages.removeChild(oldest);
      for (const [key, activity] of this.#activity) {
        if (activity === oldest) this.#activity.delete(key);
      }
    }
  }

  #observeAgent(): void {
    const observe = <Type extends XsafEvent["type"]>(
      type: Type,
      handler: (event: Extract<XsafEvent, { type: Type }>) => void,
    ) => this.#options.agent.on(type, handler);

    observe("tool.called", (event) =>
      this.setStatus(`tool:${event.sessionId}:${event.tool}`, `Tool · ${event.tool}`, "running"),
    );
    observe("tool.completed", (event) =>
      this.setStatus(`tool:${event.sessionId}:${event.tool}`, `Tool · ${event.tool}`, "success"),
    );
    observe("tool.failed", (event) =>
      this.setStatus(
        `tool:${event.sessionId}:${event.tool}`,
        `Tool · ${event.tool}: ${event.error}`,
        "error",
      ),
    );
    observe("delegate.started", (event) =>
      this.setStatus(
        `delegate:${event.sessionId}:${event.delegate}`,
        `Delegate · ${event.delegate}`,
        "running",
      ),
    );
    observe("delegate.completed", (event) =>
      this.setStatus(
        `delegate:${event.sessionId}:${event.delegate}`,
        `Delegate · ${event.delegate}`,
        "success",
      ),
    );
  }
}

export default function tui(options: XsafTuiOptions): XsafTui {
  return new XsafTui(options);
}
