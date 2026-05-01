import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./samples/posts/config.ts",
  out: "./samples/posts/migrations",
  dialect: "sqlite",
});
