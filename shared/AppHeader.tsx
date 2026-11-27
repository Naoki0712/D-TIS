import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { sharedLogo } from "./assets";
import { sitePath } from "./app-urls";

export function appUrl(app: "signage" | "controller") {
  if (app === "controller") {
    return (import.meta.env.VITE_D_TIS_CONTROLLER_URL as string | undefined)
      ?? (import.meta.env.DEV
        ? `${window.location.protocol}//${window.location.hostname}:5174${sitePath("controller/")}`
        : new URL(sitePath("controller/"), window.location.origin).href);
  }
  return (import.meta.env.VITE_D_TIS_SIGNAGE_URL as string | undefined)
    ?? (import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:5173${sitePath("signage/")}`
      : new URL(sitePath("signage/"), window.location.origin).href);
}

export function AppHeader({ product, children, collapsible = false }: {
  product: "Signage" | "Controller";
  children?: ReactNode;
  collapsible?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const menuId = useId();
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!collapsible || collapsed) return;
    let timer: ReturnType<typeof setTimeout>;
    const close = () => {
      if (header.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true });
      setCollapsed(true);
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(close, 5000);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else reset();
    };
    const events = ["pointerdown", "pointermove", "wheel", "focusin"] as const;
    events.forEach(event => document.addEventListener(event, reset, { passive: true }));
    document.addEventListener("keydown", keydown);
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach(event => document.removeEventListener(event, reset));
      document.removeEventListener("keydown", keydown);
    };
  }, [collapsible, collapsed]);
  return <div className={`app-menu-shell${collapsible ? " app-menu-overlay" : ""}`} data-collapsed={collapsed}>
    <header id={menuId} ref={header} className="app-header d-tis-menu" aria-hidden={collapsed || undefined} inert={collapsed}>
      <a className="d-tis-brand" href={sitePath("")} aria-label="D-TIS ポータルサイト">
        <img src={sharedLogo} alt="D-TIS" width="150" height="75" />
      </a>
      <nav className="d-tis-products" aria-label="ページ切替">
        <a href={sitePath("")}>ポータルサイト</a>
        <a href={appUrl("signage")} aria-current={product === "Signage" ? "page" : undefined}>Signage</a>
        <a href={appUrl("controller")} aria-current={product === "Controller" ? "page" : undefined}>Controller</a>
      </nav>
      <div className="d-tis-secondary">{children}</div>
    </header>
    {collapsible && <button ref={toggle} className="d-tis-menu-toggle" type="button" aria-expanded={!collapsed}
      aria-controls={menuId} aria-label={collapsed ? "メニューを表示" : "メニューを隠す"}
      onClick={() => setCollapsed(value => !value)}><span aria-hidden="true" /></button>}
  </div>;
}
