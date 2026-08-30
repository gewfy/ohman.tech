// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://ohman.tech",
  // Slugs stay at the root so the Tilda URLs survive the cutover
  trailingSlash: "never",
  build: { format: "directory" },
  integrations: [
    mdx(),
    sitemap({
      // Unlisted project pages (`hidden: true` in the collection).
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/$/, "") || "/";
        return path !== "/trophies-figurines";
      },
    }),
  ],
  image: {
    responsiveStyles: true,
  },
  vite: {
    build: {
      // Lightning CSS drops unprefixed backdrop-filter; Chromium needs it.
      cssMinify: "esbuild",
    },
  },
});
