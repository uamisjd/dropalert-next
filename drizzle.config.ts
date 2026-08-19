import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://dropalert@127.0.0.1:5433/dropalert",
  },
  verbose: true,
  strict: false,
} satisfies Config;
