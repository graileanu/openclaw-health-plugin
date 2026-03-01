import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { parseConfig } from "./src/config.js";
import { createHealthTools } from "./src/tools.js";

const plugin = {
  id: "openclaw-health-plugin",
  name: "Health Data Query",
  kind: "tool" as const,
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig();

    if (!cfg) {
      api.logger.warn(
        "health-query: HEALTH_SUPABASE_URL / HEALTH_SUPABASE_KEY / HEALTH_USER_ID not set, extension disabled",
      );
      return;
    }

    const tools = createHealthTools(cfg);
    for (const tool of tools) {
      api.registerTool(() => ({
        name: tool.name,
        label: tool.name.replace(/_/g, " "),
        description: tool.description,
        parameters: tool.parameters,
        execute: async (_toolCallId: string, args: Record<string, unknown>) => {
          const text = await tool.execute(args);
          return {
            content: [{ type: "text" as const, text }],
            details: text,
          };
        },
      }));
    }

    api.logger.info(
      `health-query: loaded (${tools.length} tools), querying ${cfg.supabaseUrl}`,
    );
  },
};

export default plugin;
