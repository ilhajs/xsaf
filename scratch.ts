import { xsaf } from "./packages/xsaf/src";
import http from "./packages/xsaf/src/channel/http";
import mockModel from "./packages/xsaf/src/model/mock";

const builder = xsaf
  .agent({
    model: { name: "mock-model", adapter: mockModel({ response: "http-channel" }) },
    persona: "test persona",
    stream: false,
  })
  .channel(http({ path: "/chat", apiKey: "test-key" }));

(async () => {
  await builder.start();
  const response = await builder.app.request("http://localhost/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ sessionId: "http-chat", text: "hello" }),
  });
  console.log(response.status);
  console.log(await response.text());
  await builder.stop();
})();
