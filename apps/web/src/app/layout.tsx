import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";

import { ConfirmProvider } from "@/components/Confirm";
import { OfflineBanner } from "@/components/OfflineBanner";
import { THEME_BOOT_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz", "SOFT"] });

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
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0e131d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}>
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
