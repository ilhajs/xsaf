import tui from "@xsaf/tui";
import { serve } from "srvx";
import { xsaf } from "@xsaf/agent";
import xsai from "@xsaf/agent/model/xsai";
import local from "@xsaf/agent/sandbox/local";
import { z } from "zod";

// TODO: Fill .env
const env = z
  .object({
    XSAF_MODEL: z.string(),
    XSAF_API_KEY: z.string(),
    XSAF_BASE_URL: z.string(),
  })
  .parse(process.env);

const model = xsai({
  model: env.XSAF_MODEL,
  apiKey: env.XSAF_API_KEY,
  baseURL: env.XSAF_BASE_URL,
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
  .serve({ path: "/mcp" });

await agent.start();

const server = serve({
  fetch: (request) => agent.fetch(request),
  port: Number(process.env.PORT ?? 3000),
});

const chat = tui({
  agent,
  async onExit() {
    await server.close();
    await agent.stop();
  },
});

process.on("SIGINT", () => void chat.stop());
process.on("SIGTERM", () => void chat.stop());

chat.start();
