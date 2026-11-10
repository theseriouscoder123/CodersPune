import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // Workspaces are private per visitor; only the public pages should be indexed.
  return { rules: [{ userAgent: "*", allow: ["/", "/new"], disallow: ["/w/", "/join/", "/api/"] }], sitemap: "https://baton-lac.vercel.app/sitemap.xml" };
}
