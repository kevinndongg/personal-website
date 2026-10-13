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

/**
 * Puts photos in the order the light table reads them. A page of six is read across, the top row and then the bottom row,
 * and a row is two landscape photos then a portrait one (the vertical roll), so photos are dealt out landscape, landscape,
 * portrait, landscape, landscape, portrait, and on. Landscape and portrait photos each keep their order among themselves;
 * when one kind runs out the rest of the other follows.
 */
export function lightTableOrder<T extends { aspect: number }>(items: T[]): T[] {
  const landscape = items.filter((p) => p.aspect >= 1);
  const portrait = items.filter((p) => p.aspect < 1);
  const pattern = [false, false, true, false, false, true]; // true = a portrait photo
  const out: T[] = [];
  while (landscape.length || portrait.length) {
    for (const wantPortrait of pattern) {
      const next = wantPortrait ? portrait.shift() : landscape.shift();
      if (next) out.push(next);
    }
  }
  return out;
}
