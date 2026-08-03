import tui from "@xsaf/tui";
import { serve } from "srvx";
import { xsaf } from "@xsaf/agent";
import mockModel from "@xsaf/agent/model/mock";

const model = mockModel({
  response(request) {
    const prompt = request.messages.findLast((message) => message.role === "user")?.content;
    return { text: `Mock assistant received: ${prompt ?? ""}` };
  },
});

const builder = xsaf
  .agent({
    name: "xsaf",
    description: "A deterministic interactive example agent.",
    model,
    persona: "You are a deterministic test agent.",
    stream: false,
  })
  .serve({ path: "/mcp" });

await builder.start();

const server = serve({
  fetch: (request) => builder.fetch(request),
  port: Number(process.env.PORT ?? 3000),
});

const chat = tui({
  agent: builder,
  async onExit() {
    await server.close();
    await builder.stop();
  },
});

process.on("SIGINT", () => void chat.stop());
process.on("SIGTERM", () => void chat.stop());

chat.start();
