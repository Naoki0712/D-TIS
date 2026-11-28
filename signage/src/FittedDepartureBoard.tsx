import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Fit each direction independently into its share of a designed departure part. */
export function FittedDepartureBoard({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null), design = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = frame.current!, content = design.current!;
    const fit = () => {
      const scale = Math.min(viewport.clientWidth / 1600, viewport.clientHeight / Math.max(1, content.scrollHeight + 1));
      content.style.setProperty("--layout-board-scale", String(scale));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport); observer.observe(content); fit();
    return () => observer.disconnect();
  }, []);
  return <div ref={frame} className="layout-board-frame"><div ref={design} className="layout-board-design">{children}</div></div>;
}
