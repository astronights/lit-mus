/**
 * Side-effect import that loads `.env.local` / `.env` before anything else.
 *
 * Must be the *first* import in a CLI script. ESM evaluates imports before any
 * statement in the module body, so calling `loadEnv()` as a statement would
 * run after `@/db` had already read `process.env.DATABASE_URL` and thrown.
 */
import { loadEnv } from "@/lib/load-env";

loadEnv();
