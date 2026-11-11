import type { DisplaySettings } from "../../shared/display-settings";
import { resolveAssetUrl } from "../../shared/media-storage";

/** Resolve private assets and decode the first displayed frame before recording a change. */
export async function prepareContent(settings: DisplaySettings, signal: AbortSignal) {
  let finished = false;
  const jobs: Promise<unknown>[] = [];
  const custom = settings.appearance?.customFont;
  if (custom && (settings.appearance?.preset === "custom" || settings.ticker?.segments.some(s => s.font === "custom"))) {
    jobs.push(resolveAssetUrl(custom.url).then(url => new FontFace("DTISPreflight", `url(${JSON.stringify(url)}) format(${JSON.stringify(custom.format)})`).load()));
  }
  const first = settings.media?.[0];
  let dispose = () => {};
  if (first) jobs.push(resolveAssetUrl(first.url).then(url => new Promise<void>((resolve, reject) => {
    if (signal.aborted || finished) { reject(new Error("操作を中断しました。")); return; }
    const element = first.kind === "image" ? new Image() : document.createElement("video");
    const finish = (error?: Error) => { dispose(); error ? reject(error) : resolve(); };
    element.addEventListener(first.kind === "image" ? "load" : "loadeddata", () => finish(), { once: true });
    element.addEventListener("error", () => finish(new Error("写真・映像をこのSignageで再生できません。形式とURLを確認してください。")), { once: true });
    const abort = () => finish(new Error("操作を中断しました。"));
    signal.addEventListener("abort", abort, { once: true });
    dispose = () => { signal.removeEventListener("abort", abort); element.removeAttribute("src"); if (element instanceof HTMLVideoElement) element.load(); };
    if (element instanceof HTMLVideoElement) { element.muted = true; element.playsInline = true; element.preload = "auto"; }
    element.src = url;
  })));
  if (!jobs.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.all(jobs), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("コンテンツの読み込みがタイムアウトしました。ファイルや通信状況を確認してください。")), 10_000);
    })]);
  } finally { finished = true; clearTimeout(timer); dispose(); }
}
