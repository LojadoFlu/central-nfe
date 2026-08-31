import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Ambiente por arquivo: os testes de motor rodam em node (rápido); os de
    // componente pedem jsdom com `// @vitest-environment jsdom`.
    environment: "node",
    setupFiles: ["./tests/setup-dom.ts"],
  },
});
