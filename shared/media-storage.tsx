import { useEffect, useState } from "react";
import { getCloudClient } from "./cloud";
import type { MediaItem } from "./display-settings";
import { assetUrl } from "./content-settings";

const bucket = "dtis-media";
const prefix = `storage://${bucket}/`;
const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();
export type UploadKind = "image" | "video" | "font";
const formats: Record<UploadKind, Record<string, string>> = {
  image: { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" },
  video: { mp4: "video/mp4", webm: "video/webm", m4v: "video/mp4", mov: "video/quicktime" },
  font: { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" },
};
export function validateUpload(file: Pick<File, "name" | "size">, kind: UploadKind) {
  const ext = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const mime = formats[kind][ext];
  const limit = (kind === "video" ? 50 : kind === "image" ? 20 : 10) * 1024 * 1024;
  if (!mime) throw new Error(kind === "font" ? "WOFF2・WOFF・TTF・OTF形式を選んでください。" : kind === "video" ? "MP4・WebM・MOV形式を選んでください。" : "PNG・JPEG・WebP・GIF・AVIF形式を選んでください。");
  if (!file.size || file.size > limit) throw new Error(`ファイルは${limit / 1024 / 1024}MB以内で選んでください。`);
  return { ext, mime };
}
export async function uploadAsset(file: File, kind: UploadKind): Promise<string> {
  const { ext, mime } = validateUpload(file, kind);
  const client = getCloudClient();
  const { data, error: authError } = await client.auth.getUser();
  if (authError || !data.user) throw new Error("ログインしてからファイルを追加してください。");
  const path = `${data.user.id}/${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from(bucket).upload(path, file, { contentType: mime, cacheControl: "3600", upsert: false });
  if (error) throw new Error(/bucket|not found|row.level|policy|unauthorized/i.test(error.message)
    ? "ファイル保存の準備が完了していません。URLを入力するか、サービス管理者にお知らせください。"
    : "アップロードできませんでした。ファイルサイズと通信状況を確認してください。");
  return prefix + path;
}
export async function resolveAssetUrl(value: string): Promise<string> {
  if (!assetUrl(value)) throw new Error("ファイルのURLを確認してください。");
  if (!value.startsWith(prefix)) return value;
  const client = getCloudClient();
  const { data } = await client.auth.getSession();
  const owner = data.session?.user.id;
  if (!owner || value.slice(prefix.length).split("/")[0] !== owner) throw new Error("このファイルを表示するアカウントでログインしてください。");
  const cacheKey = `${owner}|${value}`;
  const found = cache.get(cacheKey);
  if (found && found.expires > Date.now()) return found.url;
  if (pending.has(cacheKey)) return pending.get(cacheKey)!;
  const task = (async () => {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(value.slice(prefix.length), 3600);
    if (error || !data?.signedUrl) throw new Error("保存したファイルを取得できませんでした。");
    cache.set(cacheKey, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  })().finally(() => pending.delete(cacheKey));
  pending.set(cacheKey, task);
  return task;
}
export function useAssetUrl(value?: string): { url: string; loading: boolean; error: string } {
  const [state, setState] = useState({ url: "", loading: !!value, error: "" });
  useEffect(() => {
    let alive = true;
    async function refresh() {
      if (!value) { setState({ url: "", loading: false, error: "" }); return; }
      try { const url = await resolveAssetUrl(value); if (alive) setState({ url, loading: false, error: "" }); }
      catch (error) { if (alive) setState({ url: "", loading: false, error: error instanceof Error ? error.message : "ファイルを読み込めません。" }); }
    }
    setState({ url: "", loading: !!value, error: "" }); void refresh();
    const timer = setInterval(() => void refresh(), 45 * 60 * 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [value]);
  return state;
}
export function useMediaUrls(media: MediaItem[] = []): { items: MediaItem[]; loading: boolean; error: string } {
  const signature = JSON.stringify(media);
  const [state, setState] = useState<{ items: MediaItem[]; loading: boolean; error: string }>({ items: [], loading: !!media.length, error: "" });
  useEffect(() => {
    let alive = true;
    const source: MediaItem[] = JSON.parse(signature);
    async function refresh() {
      const result = await Promise.allSettled(source.map(async item => ({ ...item, url: await resolveAssetUrl(item.url) })));
      if (!alive) return;
      setState({ items: result.flatMap(item => item.status === "fulfilled" ? [item.value] : []), loading: false,
        error: result.some(item => item.status === "rejected") ? "一部の写真・映像を取得できません。" : "" });
    }
    setState({ items: [], loading: !!source.length, error: "" }); void refresh();
    const timer = setInterval(() => void refresh(), 45 * 60 * 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [signature]);
  return state;
}
