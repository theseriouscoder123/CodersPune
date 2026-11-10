import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://baton-lac.vercel.app/", changeFrequency: "weekly", priority: 1 },
    { url: "https://baton-lac.vercel.app/new", changeFrequency: "monthly", priority: 0.6 },
  ];
}
