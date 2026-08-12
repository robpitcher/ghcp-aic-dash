import type { Metadata } from "next";
import { Sora, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Primary UI typeface — geometric sans for all Latin scripts. Exposed as the
// `--font-sora` CSS variable consumed by the Tailwind theme.
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

// Monospace typeface for code, identifiers, API paths and tabular figures.
const cascadiaCode = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-cascadia-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Copilot AI Credit Dashboard",
  description:
    "See your own GitHub Copilot AI credit consumption for the month.",
};

// Apply the persisted (or OS) theme before paint to avoid a flash and keep the
// server/client markup in sync (html carries suppressHydrationWarning).
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('aic-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored ? stored === 'dark' : prefersDark;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sora.variable} ${cascadiaCode.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
