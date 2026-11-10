import { useEffect, useRef, useState } from "react";
import { getFontEmbedCSS, toJpeg } from "html-to-image";
import type { DeviceChannel } from "./cloud";

function iceServers(): RTCIceServer[] {
  try {
    const value = import.meta.env.VITE_WEBRTC_ICE_SERVERS;
    if (value) { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed; }
  } catch { /* Fall back to STUN and the image preview. */ }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}
const err = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Capture the actual rendered Signage DOM; never reconstruct a Controller imitation. */
export function SignageSharing({ channel, outputId }: { channel: DeviceChannel | null; outputId?: string }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const peers = useRef(new Map<string, RTCPeerConnection>());
  useEffect(() => {
    if (!channel) return;
    let alive = true, captureBusy = false, watchUntil = 0, lastCapture = 0;
    let fonts: string | undefined;
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();
    async function offer(viewer: string) {
      if (!stream || peers.current.has(viewer) || peers.current.size >= 8) return;
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      peers.current.set(viewer, pc);
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      pc.onicecandidate = event => { if (event.candidate) void channel!.send({ type: "rtc-ice", viewer, from: "signage", candidate: event.candidate.toJSON() }).catch(() => {}); };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState)) { pc.close(); peers.current.delete(viewer); }
      };
      try { await pc.setLocalDescription(await pc.createOffer()); await channel!.send({ type: "rtc-offer", viewer, description: pc.localDescription!.toJSON() }); }
      catch (error) { pc.close(); peers.current.delete(viewer); if (alive) setError(err(error)); }
    }
    const off = channel.on(message => {
      if (message.type === "watch" && typeof message.viewer === "string" && message.viewer.length <= 80) {
        watchUntil = Date.now() + 15000;
        if (stream) void offer(message.viewer);
      }
      if (message.type === "unwatch" && typeof message.viewer === "string") {
        peers.current.get(message.viewer)?.close(); peers.current.delete(message.viewer);
      }
      if (message.type === "rtc-answer" && typeof message.viewer === "string") {
        const pc = peers.current.get(message.viewer);
        if (pc && !pc.remoteDescription && message.description) void pc.setRemoteDescription(message.description as RTCSessionDescriptionInit).then(async () => {
          for (const candidate of pendingIce.get(message.viewer as string) ?? []) await pc.addIceCandidate(candidate);
          pendingIce.delete(message.viewer as string);
        }).catch(error => { if (alive) setError(err(error)); });
      }
      if (message.type === "rtc-ice" && message.from === "controller" && typeof message.viewer === "string" && message.candidate) {
        const pc = peers.current.get(message.viewer);
        if (pc?.remoteDescription) void pc.addIceCandidate(message.candidate as RTCIceCandidateInit).catch(() => {});
        else if (pc) pendingIce.set(message.viewer, [...(pendingIce.get(message.viewer) ?? []), message.candidate as RTCIceCandidateInit].slice(-64));
      }
    });
    const timer = window.setInterval(() => {
      if (captureBusy || Date.now() > watchUntil || Date.now() - lastCapture < 2000) return;
      const element = document.querySelector<HTMLElement>(".signage");
      if (!element) return;
      captureBusy = true; lastCapture = Date.now();
      void (async () => {
        try {
          fonts ??= await getFontEmbedCSS(element);
          const width = Math.min(1120, element.scrollWidth);
          const height = Math.min(1600, Math.round(element.scrollHeight * width / element.scrollWidth));
          const jpeg = await toJpeg(element, { quality: .65, pixelRatio: 1, canvasWidth: width, canvasHeight: height, fontEmbedCSS: fonts,
            backgroundColor: getComputedStyle(document.body).backgroundColor,
            filter: node => !(node instanceof HTMLElement && node.hasAttribute("data-preview-ignore")) });
          if (alive && jpeg.length < 200000) await channel.send({ type: "frame", jpeg, capturedAt: new Date().toISOString(), outputId: outputId ?? "primary", width: element.scrollWidth, height: element.scrollHeight });
          else if (alive && jpeg.length >= 200000) setError("画像が大きいためプレビューを送信できません。画面共有を使用してください。");
        } catch (error) { if (alive) setError(`画像プレビュー: ${err(error)}`); }
        finally { captureBusy = false; }
      })();
    }, 700);
    return () => {
      alive = false; off(); window.clearInterval(timer);
      for (const pc of peers.current.values()) pc.close(); peers.current.clear();
    };
  }, [channel, stream, outputId]);
  useEffect(() => () => { stream?.getTracks().forEach(track => track.stop()); }, [stream]);
  async function share() {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("このブラウザーは画面共有に対応していません。画像プレビューを使用します。");
      const next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
      next.getVideoTracks()[0].onended = () => { setStream(null); void channel?.send({ type: "rtc-ended" }).catch(() => {}); };
      setStream(next); setError("");
    } catch (error) { setError(err(error)); }
  }
  return <aside className="signage-sharing" data-preview-ignore>
    <button type="button" disabled={!channel} onClick={() => {
      if (stream) { stream.getTracks().forEach(track => track.stop()); setStream(null); void channel?.send({ type: "rtc-ended" }).catch(() => {}); }
      else void share();
    }}>{stream ? "画面共有を停止" : "映像で画面を共有"}</button>
    {error && <span role="status">{error}</span>}
  </aside>;
}

export function LivePreview({ channel, online }: { channel: DeviceChannel | null; online: boolean }) {
  const [frame, setFrame] = useState<{ jpeg: string; at: string; output: string } | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = remote; }, [remote, online]);
  useEffect(() => {
    setFrame(null); setRemote(null); setError("");
    if (!channel) return;
    const viewer = crypto.randomUUID();
    let alive = true, pc: RTCPeerConnection | null = null;
    let ice: RTCIceCandidateInit[] = [];
    async function accept(description: RTCSessionDescriptionInit) {
      pc?.close(); pc = new RTCPeerConnection({ iceServers: iceServers() });
      const current = pc;
      pc.onicecandidate = event => { if (event.candidate) void channel!.send({ type: "rtc-ice", viewer, from: "controller", candidate: event.candidate.toJSON() }).catch(() => {}); };
      pc.ontrack = event => { if (alive) { setRemote(event.streams[0] ?? new MediaStream([event.track])); setError(""); } };
      pc.onconnectionstatechange = () => {
        if (alive && ["failed", "disconnected", "closed"].includes(current.connectionState)) {
          setRemote(null); setError("映像の接続が途切れたため、画像プレビューで確認します。");
        }
      };
      await pc.setRemoteDescription(description);
      for (const candidate of ice) await pc.addIceCandidate(candidate); ice = [];
      await pc.setLocalDescription(await pc.createAnswer());
      await channel!.send({ type: "rtc-answer", viewer, description: pc.localDescription!.toJSON() });
    }
    const off = channel.on(message => {
      if (message.type === "frame" && typeof message.jpeg === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(message.jpeg) && message.jpeg.length < 200000 && typeof message.capturedAt === "string" && Number.isFinite(Date.parse(message.capturedAt))) {
        setFrame({ jpeg: message.jpeg, at: message.capturedAt, output: String(message.outputId ?? "primary") });
      }
      if (message.type === "rtc-offer" && message.viewer === viewer && message.description) void accept(message.description as RTCSessionDescriptionInit).catch(error => { if (alive) { setRemote(null); setError(err(error)); } });
      if (message.type === "rtc-ice" && message.viewer === viewer && message.from === "signage" && message.candidate) {
        if (pc?.remoteDescription) void pc.addIceCandidate(message.candidate as RTCIceCandidateInit).catch(() => {});
        else ice = [...ice, message.candidate as RTCIceCandidateInit].slice(-64);
      }
      if (message.type === "rtc-ended") { pc?.close(); pc = null; setRemote(null); }
    });
    const watch = () => { void channel.send({ type: "watch", viewer }).catch(error => { if (alive) setError(err(error)); }); setNow(Date.now()); };
    watch(); const timer = window.setInterval(watch, 5000);
    return () => { alive = false; off(); window.clearInterval(timer); pc?.close(); void channel.send({ type: "unwatch", viewer }).catch(() => {}); };
  }, [channel]);
  const stale = !!frame && now - Date.parse(frame.at) > 12000;
  return <section className="cloud-preview" aria-label="Signageのライブ画面">
    <header><h2>Signageのライブ画面</h2><span>{remote && online ? "映像で接続中" : frame && online && !stale ? "画像を更新中" : "画面の応答を待っています"}</span></header>
    <div className="cloud-preview-stage">{remote && online ? <video ref={video} autoPlay playsInline muted aria-label="Signageの共有映像" /> : frame ? <img src={frame.jpeg} alt={`Signageが送信した画面（${frame.output}）`} style={{ opacity: stale || !online ? .45 : 1 }} /> : <p>Signageを開くと、実際の表示画像が約2秒間隔で届きます。<br />Signage側で「映像で画面を共有」を選ぶと、共有映像に切り替わります。</p>}</div>
    <footer>{frame && <>画像取得: {new Date(frame.at).toLocaleTimeString("ja-JP")} · 出力: {frame.output}{stale || !online ? " · 接続が切れています（最終画像）" : ""}<br /></>}
      {error || "画像はSignageのブラウザーで描画した内容です。映像共有では、共有するSignageタブを選択してください。"}</footer>
  </section>;
}
