import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      image: image().optional(),
      alt: z.string().optional(),
      role: z.string().optional(),
      dateRange: z.string().optional(),
      organization: z.string().optional(),
      // the overlay card's own header (the card on the home screen), when the plain fields above do not suit it
      cardLogo: z.boolean().optional(), // false: no logo on the card
      cardBrand: z.string().optional(), // the line beside the logo (default: the organisation, unless the title already says it)
      cardNote: z.string().optional(), // a line under the logo
      location: z.string().optional(),
      period: z.string().optional(),
      techStack: z.array(z.string()).optional(),
      links: z
        .object({
          repo: z.string().url().optional(),
          demo: z.string().url().optional(),
          paper: z.string().url().optional(),
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

const photos = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/photos" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      image: image(),
      alt: z.string(),
      caption: z.string().optional(),
      location: z.string().optional(),
      dateTaken: z.string().optional(),
      tags: z.array(z.string()).optional(),
      featured: z.boolean().optional(),
    }),
});

export const collections = { projects, photos };
