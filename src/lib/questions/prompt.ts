import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The prompt is a version-controlled artifact, not a string literal in code
 * (Section 5a). It is read from disk once per process and cached.
 *
 * `outputFileTracingIncludes` in next.config.ts keeps `prompts/` in the
 * serverless bundle -- Next's tracer cannot see a runtime `readFileSync` path.
 */

export type LoadedPrompt = {
  version: string;
  template: string;
};

let cached: LoadedPrompt | null = null;

export function loadPrompt(): LoadedPrompt {
  if (cached) return cached;

  const file = path.join(process.cwd(), "prompts", "question-generation.md");
  const raw = readFileSync(file, "utf8");

  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  if (!frontMatter) {
    throw new Error("prompts/question-generation.md is missing its front matter block");
  }

  const version = /^version:\s*(.+)$/m.exec(frontMatter[1]!)?.[1]?.trim();
  if (!version) {
    throw new Error("prompts/question-generation.md front matter has no `version`");
  }

  cached = { version, template: raw.slice(frontMatter[0].length).trim() };
  return cached;
}

export type PromptContext = {
  title: string;
  author: string | null;
  characters: string[];
  /** The stored Wikipedia document: "about the work" text plus the plot. */
  sourceText: string;
};

/** Substitute the grounding context into the template's placeholders. */
export function renderPrompt(template: string, context: PromptContext): string {
  return template
    .replaceAll("{{TITLE}}", context.title)
    .replaceAll("{{AUTHOR}}", context.author ?? "Unknown")
    .replaceAll(
      "{{CHARACTERS}}",
      context.characters.length > 0
        ? context.characters.map((name) => `- ${name}`).join("\n")
        : "(none supplied)",
    )
    // Gemini Flash has a large context window, but a 30k-character article
    // buys nothing for three questions and costs latency.
    .replaceAll(
      "{{SOURCE}}",
      context.sourceText.slice(0, 14_000) || "(no article text available)",
    );
}
