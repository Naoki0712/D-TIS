import { useEffect, useRef } from "react";
import type { TickerSettings } from "../../shared/display-settings";

export function RichTicker({ text, ticker }: { text: string; ticker?: TickerSettings }) {
  const viewport = useRef<HTMLElement>(null), track = useRef<HTMLDivElement>(null);
  const segments = ticker?.segments ?? [{ id: "plain", text }];
  const signature = JSON.stringify(ticker ?? text);
  useEffect(() => {
    const box = viewport.current, line = track.current;
    if (!box || !line) return;
    let frame = 0, x = box.clientWidth, last = 0, pause = 0;
    const passed = new Set<string>();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const reset = () => { x = box.clientWidth; last = 0; passed.clear(); pause = 0; };
    const resize = new ResizeObserver(reset); resize.observe(box); resize.observe(line);
    const animate = (time: number) => {
      const dt = last ? Math.min((time - last) / 1000, .1) : 0; last = time;
      if (reduced.matches) { line.style.transform = "none"; }
      else if (!box.matches(":hover,:focus-within")) {
        if (pause > 0) pause = Math.max(0, pause - dt);
        else {
          const next = x - (ticker?.speed ?? 70) * dt;
          for (const part of Array.from(line.querySelectorAll<HTMLElement>("[data-pause]"))) {
            const duration = Number(part.dataset.pause);
            const threshold = box.clientWidth / 2 - part.offsetLeft - part.offsetWidth;
            if (duration > 0 && !passed.has(part.dataset.id!) && x >= threshold && next <= threshold) {
              passed.add(part.dataset.id!); pause = duration; x = threshold; break;
            }
          }
          if (!pause) x = next;
          if (x < -line.scrollWidth) { x = box.clientWidth; passed.clear(); }
        }
        line.style.transform = `translateX(${x}px)`;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [signature]);
  if (!segments.some(s => s.text)) return null;
  return <footer ref={viewport} className="signage-ticker rich-ticker" aria-label="お知らせ" tabIndex={0}>
    <div className="rich-ticker-track" ref={track}>{segments.map(segment => <span key={segment.id} data-id={segment.id} data-pause={segment.pauseSeconds ?? 0}
      className={`ticker-font-${segment.font ?? "inherit"}${segment.blink ? " ticker-blink" : ""}`}
      style={{ color: segment.color, fontWeight: segment.font === "mincho" ? 400 : segment.weight }}>{segment.text.replace(/\r?\n/g, "　")}</span>)}</div>
  </footer>;
}
