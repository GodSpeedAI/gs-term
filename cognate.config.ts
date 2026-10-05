import type { CognateConfig } from "@cognate/cli";

// Optional entry for the vendored `cognate dev` flow (chat-profile demo over the same domain
// model). The gs-term product runs via `bun run dev` (src/server/index.ts) — see README.md.
export default {
  profile: "copilot",
  instructions: "gs-term domain model demo agent. The semantic terminal/control plane is served by bun run dev.",
} satisfies CognateConfig;

