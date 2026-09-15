export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const cleanPath = path.replace(/^\//, "");
  return cleanPath ? `${base}/${cleanPath}` : `${base}/`;
}
