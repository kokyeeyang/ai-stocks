import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.tsx"],
    include: ["test/**/*.test.ts?(x)"],
    clearMocks: true,
  },
});
