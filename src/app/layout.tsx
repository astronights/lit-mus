import type { Metadata, Viewport } from "next";
import { Bangers, Chewy, Inter, Literata, Patrick_Hand, Shantell_Sans } from "next/font/google";

import "./globals.css";

import { Providers } from "@/components/providers";
import { TabBar } from "@/components/tab-bar";
import { FONT_INIT_SCRIPT } from "@/lib/preferences";

/*
 * Six faces, three pairings (Section 5e). `latin-ext` is not optional: this
 * app is full of names like Buendía, Ngũgĩ and García Márquez, and a missing
 * glyph makes the browser substitute a fallback mid-word.
 *
 * Only the Clean pairing preloads. The design doc wanted the other pairings
 * fetched on selection; `next/font` self-hosts everything at build time, so
 * the achievable version is `preload: false` -- the files exist but are not in
 * the initial critical path, and the browser fetches them when the pairing is
 * actually applied.
 */
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin", "latin-ext"],
  variable: "--font-literata",
  display: "swap",
});

const bangers = Bangers({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-bangers",
  display: "swap",
  preload: false,
});

const shantellSans = Shantell_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-shantell",
  display: "swap",
  preload: false,
});

const chewy = Chewy({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-chewy",
  display: "swap",
  preload: false,
});

const patrickHand = Patrick_Hand({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-patrick-hand",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "lit-mus",
  description: "Quiz-ready reference for books, from Black Beauty to Maali Almeida.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "lit-mus", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1917" },
  ],
};

const fontVariables = [inter, literata, bangers, shantellSans, chewy, patrickHand]
  .map((font) => font.variable)
  .join(" ");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={fontVariables}>
      <head>
        {/* Runs before paint, like the next-themes script, to avoid a font flash. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4">
            <main className="flex-1 pt-4">{children}</main>
          </div>
          <TabBar />
        </Providers>
      </body>
    </html>
  );
}
