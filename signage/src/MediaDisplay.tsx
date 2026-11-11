import { useEffect, useState } from "react";
import type { MediaItem } from "../../shared/display-settings";
import { useMediaUrls } from "../../shared/media-storage";
export function MediaDisplay({ media, visible = true }: { media: MediaItem[]; visible?: boolean }) {
  const { items, loading, error } = useMediaUrls(media);
  const [index, setIndex] = useState(0), [failed, setFailed] = useState("");
  const item = items[index % Math.max(1, items.length)];
  useEffect(() => { setIndex(0); setFailed(""); }, [JSON.stringify(media)]);
  useEffect(() => {
    if (!item) return;
    const timer = setTimeout(() => { setIndex(i => i + 1); setFailed(""); }, item.durationSeconds * 1000);
    return () => clearTimeout(timer);
  }, [item, index]);
  return <aside className="signage-media" aria-label="オリジナルコンテンツ" hidden={!visible}>
    {item && failed !== item.id ? item.kind === "image"
      ? <img key={item.id} src={item.url} alt={item.alt} onError={() => setFailed(item.id)} />
      : <video key={item.id} src={item.url} aria-label={item.alt || "案内映像"} autoPlay muted playsInline loop={items.length === 1} preload="auto" onError={() => setFailed(item.id)} onEnded={() => { setIndex(i => i + 1); setFailed(""); }} />
      : <p>{loading ? "コンテンツを読み込んでいます…" : error || "このコンテンツを表示できません。"}</p>}
  </aside>;
}
