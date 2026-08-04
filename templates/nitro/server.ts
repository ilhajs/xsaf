import { xsaf } from "@xsaf/agent";
import http from "@xsaf/agent/channel/http";
import xsai from "@xsaf/agent/model/xsai";
import local from "@xsaf/agent/sandbox/local";
import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { z } from "zod";
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createMemoryState } from "@chat-adapter/state-memory";
import chatSdk from "@xsaf/agent/channel/chat-sdk";

import {
  buildApprovalCard,
  buildResolvedCard,
  APPROVE_ACTION_ID,
  DENY_ACTION_ID,
  type ApprovalCardOptions,
} from "chat/workflow";

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
});

const pendingApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; options: ApprovalCardOptions }
>();

bot.onAction([APPROVE_ACTION_ID, DENY_ACTION_ID], async (event) => {
  const pending = pendingApprovals.get(event.messageId);
  if (pending) {
    const approved = event.actionId === APPROVE_ACTION_ID;
    pending.resolve(approved);
    pendingApprovals.delete(event.messageId);

    await event.adapter.editMessage(
      event.threadId,
      event.messageId,
      buildResolvedCard(
        pending.options,
        approved ? `Approved by @${event.user.userName}` : `Denied by @${event.user.userName}`,
      ),
    );
  }
});

const weatherAdvisor = xsaf
  .agent({
    name: "weather_advisor",
    description: "Suggest what to wear for the reported weather.",
    model,
    persona: "Give one short, practical clothing suggestion based on the weather.",
    stream: true,
  })
  .sandbox(local())
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
    persona: "Be concise. Use get_weather for weather data and delegate clothing advice.",
    stream: true,
  })
  .approve(async (input, context) => {
    const thread = bot.thread(context.sessionId);
    const options: ApprovalCardOptions = {
      title: `Approve ${context.tool}?`,
      fields: { Input: JSON.stringify(input) },
    };

    const message = await thread.post(buildApprovalCard(options, undefined as any));

    return new Promise<boolean>((resolve) => {
      pendingApprovals.set(message.id, { resolve, options });
    });
  })
  .sandbox(local())
  .delegate(weatherAdvisor)
  .channel(http({ path: "/chat", apiKey: env.xsafChatKey }))
  .channel(chatSdk(bot))
  .serve({ path: "/mcp", host: env.xsafMcpHost });

await agent.start();

agent.app.post("/webhooks/telegram", (c) => bot.webhooks.telegram(c.req.raw));

export default defineHandler((event) => agent.fetch(event.req));
