import { xsaf } from "xsaf";
import mockChannel from "xsaf/channel/mock";
import mockModel from "xsaf/model/mock";
import { serve } from "srvx";

const model = mockModel({
  response(request) {
    const prompt = request.messages.findLast((message) => message.role === "user")?.content;
    return { text: `Mock assistant received: ${prompt ?? ""}` };
  },
});

const channel = mockChannel();

const builder = xsaf
  .agent({
    model: "mock/model",
    baseURL: "mock://local",
    apiKey: "not-used",
    persona: "You are a deterministic test agent.",
    stream: false,
    modelAdapter: model,
  })
  .channel(channel)
  .serve({ transport: "http", path: "/mcp" });

await builder.start();

const server = serve({
  fetch: builder.fetch,
  port: Number(process.env.PORT ?? 3000),
});

console.log(`Server running on port ${server.url}`);

async function shutdown() {
  await server.close();
  await builder.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
