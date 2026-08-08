import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Open Library serves every cover we display.
      { protocol: "https", hostname: "covers.openlibrary.org" },
    ],
  },
  serverExternalPackages: ["@node-rs/argon2"],
  // The prompt and the file-driven seed list are read from disk at runtime,
  // and Next's tracer cannot follow a dynamic readFileSync path -- without
  // this they are missing from the deployed bundle.
  outputFileTracingIncludes: {
    // Question generation moved from the book route into Drill; the prompt is
    // read from disk at runtime, so it has to be traced into *that* function or
    // generation fails on Vercel with a missing file.
    "/api/drill/card/[bookId]": ["./prompts/**"],
    "/api/cron/seed": ["./data/**"],
  },
};

export default nextConfig;
