import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { ConfirmProvider } from "@/components/Confirm";
import { OfflineBanner } from "@/components/OfflineBanner";
import { THEME_BOOT_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

const SITE = "https://baton-lac.vercel.app";
const DESCRIPTION =
  "Baton turns what a departing teammate leaves behind (repo, notes, chat) into a reviewed, evidence-linked handover: every claim cites its exact source, statuses come from rules, and the successor sees only what they're allowed to.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Baton · Evidence-graded knowledge handovers", template: "%s · Baton" },
  description: DESCRIPTION,
  applicationName: "Baton",
  keywords: ["knowledge handover", "offboarding", "onboarding", "engineering handover", "documentation", "evidence"],
  openGraph: { type: "website", url: SITE, siteName: "Baton", title: "Baton · Evidence-graded knowledge handovers", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Baton · Evidence-graded knowledge handovers", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121213" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <head>
        {/* Apply a saved light/dark choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <OfflineBanner />
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
