import { xsaf } from "@xsaf/agent";
import http from "@xsaf/agent/channel/http";
import { db0 } from "@xsaf/agent/memory/db0";
import xsai from "@xsaf/agent/model/xsai";
import local from "@xsaf/agent/sandbox/local";
import { defineHandler } from "nitro";
import { useDatabase } from "nitro/database";
import { useRuntimeConfig } from "nitro/runtime-config";
import { z } from "zod";
import { Actions, Button, Card, CardText, Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import chatSdk from "@xsaf/agent/channel/chat-sdk";
import { useStorage } from "nitro/storage";

const env = z
  .object({
    xsafAiModel: z.string(),
    xsafAiApiKey: z.string(),
    xsafAiBaseUrl: z.string(),
    xsafChatKey: z.string().min(1),
    xsafMcpHost: z.string().default("0.0.0.0"),
    telegramBotToken: z.string(),
    telegramWebhookSecretToken: z.string(),
    telegramBotUsername: z.string(),
  })
  .parse(useRuntimeConfig());

const model = xsai({
  model: env.xsafAiModel,
  apiKey: env.xsafAiApiKey,
  baseURL: env.xsafAiBaseUrl,
});

const bot = new Chat({
  userName: "xsaf",
  adapters: {
    telegram: createTelegramAdapter({
      botToken: env.telegramBotToken,
      secretToken: env.telegramWebhookSecretToken,
      userName: env.telegramBotUsername,
    }),
  },
  state: createMemoryState(),
}).registerSingleton();

const APPROVE = "approve";
const DENY = "deny";

type ApprovalRecord = {
  readonly tool: string;
  readonly approved?: boolean;
};

const approvals = useStorage<ApprovalRecord>("approvals");
/** Durable session history via Nitro's SQLite database (`.data/xsaf.sqlite`). */
const memory = db0(useDatabase(), { dispose: false });

bot.onAction([APPROVE, DENY], async (event) => {
  const id = event.value;
  if (!id) return;

  const pending = await approvals.getItem(id);
  const tool = pending?.tool ?? "unknown";
  const approved = event.actionId === APPROVE;
  await approvals.setItem(id, { tool, approved });

  if (event.thread) {
    await event.adapter.editMessage(
      event.threadId,
      event.messageId,
      Card({
        title: `\`${tool}\``,
        children: [CardText(approved ? "✅ Approved" : "⛔ Denied")],
      }),
    );
  }
});

/** Alpha HITL: Card + onAction, decision via Nitro storage (default: in-memory). */
async function approve(
  input: unknown,
  context: { readonly tool: string; readonly sessionId: string },
): Promise<boolean> {
  // Strip `:delegate:…` — chat-sdk thread IDs reject the mangled memory session.
  const sessionId = context.sessionId.replace(/:delegate:.*$/, "");
  const thread = bot.thread(sessionId);
  const id = crypto.randomUUID();

  // prefixStorage watch emits absolute keys (`approvals:<id>`).
  const storageKey = `approvals:${id}`;
  const decided = new Promise<boolean>((resolve) => {
    const unwatch = approvals.watch(async (event, key) => {
      if (event !== "update" || key !== storageKey) return;
      const value = await approvals.getItem(id);
      // Ignore the initial pending write (tool only, no decision yet).
      if (value?.approved == null) return;
      await (
        await unwatch
      )();
      await approvals.removeItem(id);
      resolve(value.approved);
    });
  });

  await approvals.setItem(id, { tool: context.tool });

  await thread.post(
    Card({
      title: `Approve \`${context.tool}\`?`,
      children: [
        CardText(`\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``),
        Actions([
          Button({ id: APPROVE, label: "Approve", style: "primary", value: id }),
          Button({ id: DENY, label: "Deny", style: "danger", value: id }),
        ]),
      ],
    }),
  );

  return decided;
}

const weatherAdvisor = xsaf
  .agent({
    name: "weather_advisor",
    description: "Suggest what to wear for the reported weather.",
    model,
    persona: "Give one short, practical clothing suggestion based on the weather.",
    stream: true,
  })
  .approve(approve)
  .sandbox(local({ unsafe: true }))
  .tool({
    name: "get_weather",
    description: "Get the current mocked weather for a city.",
    input: z.object({ city: z.string() }),
    approval: "human",
    async execute({ city }) {
      return { city, temperatureCelsius: 22, conditions: "sunny" };
    },
  });

const agent = xsaf
  .agent({
    name: "xsaf",
    description: "An interactive example agent with a tool and a delegate.",
    model,
    persona:
      "Be concise. Use get_weather for weather data, search_memory for past messages, and delegate clothing advice.",
    stream: true,
  })
  .approve(approve)
  .sandbox(local({ unsafe: true }))
  .memory(memory)
  .tool({
    name: "search_memory",
    description:
      "Search persisted messages by content substring across all sessions. Pass sessionId to narrow to one session.",
    input: z.object({
      query: z.string().min(1),
      sessionId: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    async execute({ query, sessionId, limit }) {
      const hits = await memory.search({ query, sessionId, limit });
      return hits.map((hit) => ({
        sessionId: hit.sessionId,
        seq: hit.seq,
        role: hit.message.role,
        content: hit.message.content,
      }));
    },
  })
  .delegate(weatherAdvisor)
  .channel(http({ path: "/chat", apiKey: env.xsafChatKey }))
  .channel(chatSdk(bot))
  .serve({ path: "/mcp", host: env.xsafMcpHost });

await agent.start();

agent.app.post("/webhooks/telegram", (c) => bot.webhooks.telegram(c.req.raw));

export default defineHandler((event) => agent.fetch(event.req));
