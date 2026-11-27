import type { DisplaySettings, ServiceStatus } from "../../shared/display-settings";
import type { CatalogLine } from "./catalog";

export function ServiceEditor({ settings, lines, disabled, onChange }: { settings: DisplaySettings; lines: CatalogLine[]; disabled: boolean; onChange(settings: DisplaySettings): void }) {
  function change(index: number, service: ServiceStatus) {
    onChange({ ...settings, selectedRoutes: settings.selectedRoutes.map((r, i) => i === index ? { ...r, service } : r) });
  }
  return <section className="studio-section service-editor"><h2>遅延・運転見合わせ</h2><p className="muted">路線・方面ごとに運行状況を指定します。通常運行に戻すまで、保存した状況を表示します。</p>
    {!settings.selectedRoutes.length && <p>路線を追加すると運行状況を設定できます。</p>}
    {settings.selectedRoutes.map((route, index) => {
      const line = lines.find(l => l.id === route.railway), station = line?.stations.find(s => s.id === route.station);
      const service = route.service ?? { status: "normal" as const, delayMinutes: 0, message: "" };
      return <fieldset className="service-route" key={`${route.railway}|${route.station}|${route.direction}`} disabled={disabled}>
        <legend>{line?.name || route.railway.split(".").at(-1)} · {station?.name} · {station?.directionNames?.[route.direction] || line?.directionNames?.[route.direction] || route.direction.split(".").at(-1)}方面</legend>
        <div className="studio-grid"><label>運行状況<select aria-label="運行状況" value={service.status} onChange={e => change(index, { ...service, status: e.target.value as ServiceStatus["status"], delayMinutes: e.target.value === "delayed" ? Math.max(1, service.delayMinutes) : 0 })}><option value="normal">通常運行</option><option value="delayed">遅延</option><option value="suspended">運転見合わせ</option></select></label>
          {service.status === "delayed" && <label>遅れ時分（分）<input type="number" min={1} max={360} step={1} value={service.delayMinutes} onChange={e => change(index, { ...service, delayMinutes: Math.max(1, Math.min(360, Math.round(Number(e.target.value)))) })} /></label>}</div>
        {service.status !== "normal" && <label>運行案内文<input value={service.message} maxLength={500} placeholder="運行状況や再開の見込みなど" onChange={e => change(index, { ...service, message: e.target.value })} /></label>}
      </fieldset>;
    })}
  </section>;
}
