import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    role: z.string().optional(),
    dateRange: z.string().optional(),
    links: z
      .object({
        repo: z.string().url().optional(),
        demo: z.string().url().optional(),
      })
      .optional(),
    accentColor: z.string().optional(),
    animation: z.enum([
      "ftc-gears",
      "racing-speed-lines",
      "uav-radar-sweep",
      "temple-allen-flight-path",
      "auton-lab-bounding-boxes",
    ]),
    order: z.number(),
  }),
});

export const collections = { projects };
