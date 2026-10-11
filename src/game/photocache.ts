// A small cache of photos, loaded when something asks for them and let go of when they have not been used for a while.
// The gallery can have any number of photos, so nothing may load them all up front or keep them all alive: the contact
// sheet asks for the thumbnails of the page it is showing (and prefetches the pages either side), and the viewer asks for
// the large image of the photo it is showing (and prefetches the ones either side).

interface Entry {
  img: HTMLImageElement;
  ready: boolean;
  used: number;
  waiting: Set<() => void>;
}

export class ImageCache {
  private entries = new Map<string, Entry>();
  private tick = 0;

  /** `limit` is how many images to keep: the ones used longest ago are dropped past it. */
  constructor(private limit = 48) {}

  /**
   * The image, if it has loaded, otherwise null and it starts loading; `onReady` (if given) is called once it has. Asking
   * again with the same function while it is still loading does not add it twice.
   */
  get(url: string, onReady?: () => void): HTMLImageElement | null {
    let e = this.entries.get(url);
    if (!e) {
      const entry: Entry = { img: new Image(), ready: false, used: 0, waiting: new Set() };
      e = entry;
      entry.img.onload = () => {
        const done = () => {
          entry.ready = true;
          const callbacks = [...entry.waiting];
          entry.waiting.clear();
          for (const f of callbacks) f();
        };
        // decoded before it is called ready, so putting it on a texture later does not stall a frame decoding it
        if (entry.img.decode) entry.img.decode().then(done, done);
        else done();
      };
      entry.img.onerror = () => entry.waiting.clear(); // it stays a grey frame
      entry.img.src = url;
      this.entries.set(url, entry);
      this.trim();
    }
    e.used = ++this.tick;
    if (e.ready) return e.img;
    if (onReady) e.waiting.add(onReady);
    return null;
  }

  private trim() {
    const extra = this.entries.size - this.limit;
    if (extra <= 0) return;
    const oldest = [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, extra);
    for (const [url] of oldest) this.entries.delete(url);
  }
}
