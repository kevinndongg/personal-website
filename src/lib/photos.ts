import type { CollectionEntry } from "astro:content";

export function sortPhotos(
  photos: CollectionEntry<"photos">[]
): CollectionEntry<"photos">[] {
  return [...photos].sort((a, b) => {
    if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;
    const aDate = a.data.dateTaken ?? "";
    const bDate = b.data.dateTaken ?? "";
    return bDate.localeCompare(aDate);
  });
}
