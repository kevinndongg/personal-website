import exifr from "exifr";
import { readdir } from "node:fs/promises";
import path from "node:path";

const PHOTOS_DIR = path.resolve("src/content/photos");

export interface PhotoExif {
  iso: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
}

function formatShutterSpeed(exposureTime?: number): string | null {
  if (!exposureTime) return null;
  if (exposureTime >= 1) return `${exposureTime}s`;
  return `1/${Math.round(1 / exposureTime)}s`;
}

function formatAperture(fNumber?: number): string | null {
  if (!fNumber) return null;
  return `f/${fNumber}`;
}

function formatIso(iso?: number): string | null {
  if (!iso) return null;
  return `ISO ${iso}`;
}

let dirListing: string[] | null = null;

async function findImageFile(slug: string): Promise<string | null> {
  if (!dirListing) {
    dirListing = await readdir(PHOTOS_DIR);
  }
  const match = dirListing.find(
    (f) => path.parse(f).name === slug && /\.(jpe?g|png|webp)$/i.test(f)
  );
  return match ? path.join(PHOTOS_DIR, match) : null;
}

export async function getPhotoExif(slug: string): Promise<PhotoExif> {
  const filePath = await findImageFile(slug);
  if (!filePath) return { iso: null, aperture: null, shutterSpeed: null };

  try {
    const data = await exifr.parse(filePath, ["ISO", "FNumber", "ExposureTime"]);
    return {
      iso: formatIso(data?.ISO),
      aperture: formatAperture(data?.FNumber),
      shutterSpeed: formatShutterSpeed(data?.ExposureTime),
    };
  } catch {
    return { iso: null, aperture: null, shutterSpeed: null };
  }
}
