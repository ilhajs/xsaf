import { Cli } from "clerc";
import tui from "./index";
import httpAgent from "./http";

Cli()
  .scriptName("xsaf")
  .description("Interactive terminal client for a remote XSAF agent")
  .version("0.1.0-alpha.0")
  .command("", "Open an interactive chat", {
    flags: {
      url: {
        type: String,
        short: "u",
        description: "Base URL of the XSAF server",
        default: "http://localhost:3000",
      },
      name: {
        type: String,
        description: "Agent name shown in the terminal",
        default: "xsaf",
      },
      session: {
        type: String,
        short: "s",
        description: "Session identifier",
        default: "tui",
      },
    },
  })
  .on("", async ({ flags }) => {
    const apiKey = process.env["API_KEY"];
    const agent = httpAgent({
      url: flags.url,
      name: flags.name,
      ...(apiKey ? { apiKey } : {}),
    });

    await new Promise<void>((resolve) => {
      const chat = tui({
        agent,
        sessionId: flags.session,
        onExit: resolve,
      });
      process.once("SIGINT", () => void chat.stop());
      process.once("SIGTERM", () => void chat.stop());
      chat.start();
    });
  })
  .parse();
