import type { Metadata } from "next";

export const metadata: Metadata = { title: "Before the leaver leaves", robots: { index: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
