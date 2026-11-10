import { useEffect, useRef, useState, type ReactNode } from "react";
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

export function AppHeader({ product, children, facilityName, facilitySecondary }: {
  product: "Signage" | "Controller";
  children?: ReactNode;
  facilityName?: string;
  facilitySecondary?: string;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const target = product === "Signage" ? "Controller" : "Signage";
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <header className={`app-header${facilityName ? " app-header-with-facility" : ""}`}>
    <div className="app-logo"><img src={sharedLogo} alt="D-TIS" /></div>
    <div className="app-navigation" ref={menu} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <button className="app-product" type="button" ref={button} aria-expanded={open}
        aria-controls="app-navigation-links" onClick={() => setOpen(value => !value)}>
        {product}<span aria-hidden="true" />
      </button>
      <nav className="app-dropdown" id="app-navigation-links" aria-label="画面切り替え" hidden={!open}>
        <a href={appUrl(target === "Signage" ? "signage" : "controller")}>{target}</a>
      </nav>
    </div>
    {facilityName && <div className="app-facility" aria-label="施設名">
      <strong>{facilityName}</strong>
      {facilitySecondary && <span>{facilitySecondary}</span>}
    </div>}
    {children}
  </header>;
}
