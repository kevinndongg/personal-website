import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: ({ image }) => {
    // what the project page shows below the text, in order: halves pair up two to a row, a full one takes a row to itself
    const placing = { size: z.enum(["half", "full"]).default("full"), caption: z.string().optional() };
    const media = z.discriminatedUnion("type", [
      z.object({ type: z.literal("image"), src: image(), alt: z.string(), ...placing }),
      // `src` and `poster` are paths under public/ (made by scripts/encode-media.mjs); width and height reserve the space
      z.object({
        type: z.literal("video"),
        src: z.string(),
        poster: z.string(),
        width: z.number(),
        height: z.number(),
        alt: z.string(),
        ...placing,
      }),
      // a YouTube video that loads only on click; `poster` is a path under public/, `start` is in seconds
      z.object({
        type: z.literal("youtube"),
        id: z.string(),
        title: z.string(),
        poster: z.string(),
        start: z.number().optional(),
        ...placing,
      }),
    ]);

    return z.object({
      title: z.string(),
      summary: z.string(),
      image: image().optional(),
      alt: z.string().optional(),
      role: z.string().optional(),
      dateRange: z.string().optional(),
      organization: z.string().optional(),
      // the overlay card's own header (the card on the home screen), when the plain fields above do not suit it
      cardLogo: z.boolean().optional(), // false: no logo on the card
      cardBrand: z.string().optional(), // beside the logo: when set it is the card's big heading, and the title below goes (or becomes cardTitle)
      cardTitle: z.string().optional(), // with cardBrand: a smaller line in the title's place
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
      media: z.array(media).optional(),
    });
  },
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
