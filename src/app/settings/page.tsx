"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { useFontPairing } from "@/components/font-provider";
import { PageHeader } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import {
  FONT_PAIRINGS,
  FONT_PAIRING_LABELS,
  GLYPH_CHECK,
  type FontPairing,
} from "@/lib/preferences";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { pairing, setPairing } = useFontPairing();
  const { data: session } = authClient.useSession();

  // next-themes only knows the resolved theme after mount; rendering the
  // selected state before then would mismatch the server HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <PageHeader title="Settings" />

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Theme
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setTheme(option.value);
                void syncTheme(option.value);
              }}
              className={`rounded-lg border px-3 py-2 text-sm ${
                mounted && theme === option.value
                  ? "border-accent bg-accent/10 font-semibold text-accent"
                  : "border-border"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Fonts
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Display for titles and riddles, body for plot text. They change together.
        </p>

        <div className="mt-3 space-y-2">
          {FONT_PAIRINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPairing(option)}
              className={`block w-full rounded-lg border px-3 py-2.5 text-left ${
                pairing === option ? "border-accent bg-accent/10" : "border-border"
              }`}
            >
              <span className="flex items-baseline justify-between">
                <span className="font-display text-[15px] font-semibold">
                  {FONT_PAIRING_LABELS[option].name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {FONT_PAIRING_LABELS[option].display} + {FONT_PAIRING_LABELS[option].body}
                </span>
              </span>
              <PairingPreview pairing={option} />
            </button>
          ))}
        </div>

        {/*
          Glyph check (Section 5e): hand-drawn faces are the likeliest to have
          gaps in latin-ext, and a missing glyph silently falls back mid-word,
          which looks like a rendering bug. Eyeball this line after any font
          change.
        */}
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{GLYPH_CHECK}</p>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Account
        </h2>
        {session?.user ? (
          <>
            <p className="mt-2 text-sm">{session.user.email}</p>
            <button
              type="button"
              onClick={() => authClient.signOut().then(() => window.location.reload())}
              className="mt-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              Sign out
            </button>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Not signed in. Browse and Search work anyway.
          </p>
        )}
      </section>
    </>
  );
}

/** Renders the sample in the pairing being offered, not the active one. */
function PairingPreview({ pairing }: { pairing: FontPairing }) {
  return (
    <span data-fonts={pairing} className="mt-1 block">
      <span className="block font-display text-lg leading-tight">Seven moons, one killer</span>
      <span className="block text-[13px] leading-snug text-muted-foreground">
        A war photographer wakes up dead with a week to solve his own murder.
      </span>
    </span>
  );
}

function syncTheme(theme: string) {
  return fetch("/api/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
}
