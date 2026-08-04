import { defineConfig } from "nitro";

export default defineConfig({
  modules: ["workflow/nitro"],
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
