import { xsaf } from "@xsaf/agent";
import http from "@xsaf/agent/channel/http";
import xsai from "@xsaf/agent/model/xsai";
import local from "@xsaf/agent/sandbox/local";
import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { z } from "zod";
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createRedisState } from "@chat-adapter/state-redis";
import chatSdk from "@xsaf/agent/channel/chat-sdk";

const env = z
  .object({
    xsafAiModel: z.string(),
    xsafAiApiKey: z.string(),
    xsafAiBaseUrl: z.string(),
    xsafChatKey: z.string().min(1),
    xsafMcpHost: z.string().default("0.0.0.0"),
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
    telegram: createTelegramAdapter(),
  },
  state: createRedisState(),
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
    approval: "auto",
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
  .sandbox(local())
  .delegate(weatherAdvisor)
  .channel(http({ path: "/chat", apiKey: env.xsafChatKey }))
  .channel(chatSdk(bot))
  .serve({ path: "/mcp", host: env.xsafMcpHost });

agent.app.post("/webhooks/telegram", (c) => bot.webhooks.telegram(c.req.raw));

await agent.start();

export default defineHandler((event) => agent.fetch(event.req));
