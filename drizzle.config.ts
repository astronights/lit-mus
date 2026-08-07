import { defineConfig } from "drizzle-kit";

import { requireEnv } from "./src/lib/load-env";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Reads .env.local then .env, like Next.js does -- plain `dotenv` only
    // reads .env, which made `npm run db:push` ignore the documented file.
    url: requireEnv("DATABASE_URL"),
  },
  strict: true,
  verbose: true,
});
