"use client";

import { ThemeProvider } from "next-themes";

import { FontProvider } from "@/components/font-provider";

/**
 * `defaultTheme="system"` is the point of using next-themes here: on a phone,
 * following the OS is what people actually want, and the library's blocking
 * script sets the class before first paint so a dark-mode load never flashes
 * white.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <FontProvider>{children}</FontProvider>
    </ThemeProvider>
  );
}
