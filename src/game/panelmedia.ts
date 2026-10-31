import type { ZoneMedia } from "./world";

export interface PanelMedia {
  nodes: HTMLElement[];
  /** Stops every clip and lets go of the observer (the nodes stay, so the card can fade out with its pictures). */
  stop: () => void;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function element(m: ZoneMedia, clips: HTMLVideoElement[]): HTMLElement {
  if (m.type === "image") {
    const img = make("img");
    img.src = m.src;
    img.alt = m.alt;
    img.width = m.width;
    img.height = m.height;
    img.loading = "lazy";
    img.decoding = "async";
    return img;
  }

  if (m.type === "video") {
    const video = make("video");
    video.src = m.src;
    video.poster = m.poster;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", m.alt);
    video.style.aspectRatio = `${m.width} / ${m.height}`;
    video.style.setProperty("--ar", String(m.width / m.height)); // (the css sizes the box by it, so there is never a bar)
    clips.push(video);
    return video;
  }

  // nothing is asked of YouTube until the viewer presses the picture
  const button = make("button", "media-youtube");
  button.type = "button";
  button.setAttribute("aria-label", `Play video: ${m.title}`);
  const poster = make("img");
  poster.src = m.poster;
  poster.alt = "";
  poster.loading = "lazy";
  button.append(poster, make("span", "media-play"));
  button.addEventListener(
    "click",
    () => {
      const frame = make("iframe");
      frame.src = m.embed;
      frame.title = m.title;
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      button.replaceChildren(frame);
      button.removeAttribute("aria-label");
    },
    { once: true }
  );
  return button;
}

/**
 * The pictures and clips of a project's card. The clips play (muted, in a loop) while they are in view and stop when they
 * scroll out of it or the card closes; one the viewer paused stays paused, and none plays by itself if they prefer less motion.
 */
export function buildMedia(items: ZoneMedia[]): PanelMedia {
  const clips: HTMLVideoElement[] = [];
  const nodes = items.map((m) => {
    const figure = make("figure", `media-item ${m.size}`);
    figure.append(element(m, clips));
    if (m.caption) {
      const caption = make("figcaption");
      caption.textContent = m.caption;
      figure.append(caption);
    }
    return figure;
  });

  let observer: IntersectionObserver | undefined;
  if (clips.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const pausedByViewer = new WeakSet<HTMLVideoElement>();
    const pausedByUs = new WeakSet<HTMLVideoElement>();
    observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const video = target as HTMLVideoElement;
          if (isIntersecting) {
            if (!pausedByViewer.has(video)) void video.play().catch(() => {});
          } else if (!video.paused) {
            pausedByUs.add(video);
            video.pause();
          }
        }
      },
      { threshold: 0.4 }
    );
    for (const video of clips) {
      // a pause we did not cause is the viewer's
      video.addEventListener("pause", () => {
        if (!pausedByUs.delete(video)) pausedByViewer.add(video);
      });
      video.addEventListener("play", () => pausedByViewer.delete(video));
      observer.observe(video);
    }
  }

  return {
    nodes,
    stop() {
      observer?.disconnect();
      for (const video of clips) video.pause();
    },
  };
}
