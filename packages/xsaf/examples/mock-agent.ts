import { agent } from "../src";
import mockChannel from "../src/channel/mock";
import mockModel from "../src/model/mock";

const ai = mockModel({
  response(request) {
    const prompt = request.messages.findLast((message) => message.role === "user")?.content;
    return { text: `Mock assistant received: ${prompt ?? ""}` };
  },
});
const transport = mockChannel();

const demo = agent({
  model: ai,
  persona: "You are a deterministic test agent.",
  stream: false,
})
  .channel(transport)
  .serve({ path: "/mcp" });

await demo.start();
await transport.receive({ sessionId: "demo", text: "hello xsaf" });

const sent = transport.sent.at(0);
if (!sent || typeof sent.payload !== "string") {
  throw new Error("Mock transport did not receive a text response");
}

console.log(sent.payload);

const response = await demo.app.request("http://localhost/invoke", {
  method: "POST",
  headers: { host: "localhost", "content-type": "application/json" },
  body: JSON.stringify({ sessionId: "http-demo", prompt: "hello hono" }),
});
if (!response.ok) throw new Error(`Hono request failed: ${response.status}`);
console.log(await response.json());
console.log(`Mock AI requests: ${ai.requests.length}`);
await demo.stop();
