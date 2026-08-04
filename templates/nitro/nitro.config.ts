import { defineConfig } from "nitro";

export default defineConfig({
  experimental: {
    database: true,
  },
  database: {
    default: {
      connector: "sqlite",
      options: { name: "xsaf" },
    },
  },
  runtimeConfig: {
    xsafAiModel: "",
    xsafAiApiKey: "",
    xsafAiBaseUrl: "https://openrouter.ai/api/v1",
    xsafChatKey: "",
    xsafMcpHost: "",
    telegramBotToken: "",
    telegramWebhookSecretToken: "",
    telegramBotUsername: "xsaf",
  },
});
