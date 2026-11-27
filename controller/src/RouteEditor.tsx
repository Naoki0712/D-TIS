import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { railwayAsset } from "../../shared/assets";
import { railwayColor } from "../../shared/railway";
import { routeDisplaySettings, type DisplaySettings, type RouteDisplaySettings, type SelectedRoute } from "../../shared/display-settings";
import { groupRoutes, matchingLines, routeGroupKey, stationChoices, type CatalogLine, type StationChoice } from "./catalog";
import { StationMap } from "./StationMap";

export function RouteEditor({ settings, lines, disabled, onChange }: {
  settings: DisplaySettings; lines: CatalogLine[]; disabled: boolean; onChange(settings: DisplaySettings): void;
}) {
  const addDialog = useRef<HTMLDialogElement>(null);
  const editDialog = useRef<HTMLDialogElement>(null);
  const [stationQuery, setStationQuery] = useState("");
  const [lineQuery, setLineQuery] = useState("");
  const [pickerMode, setPickerMode] = useState<"search" | "map">("search");
  const pickerId = useId();
  const [visibleCount, setVisibleCount] = useState(120);
  const [chosenStation, setChosenStation] = useState<StationChoice>();
  const [chosenLine, setChosenLine] = useState("");
  const [editing, setEditing] = useState<SelectedRoute>();
  const [directions, setDirections] = useState<string[]>([]);
  const [options, setOptions] = useState<Required<RouteDisplaySettings>>(routeDisplaySettings({ railway: "", station: "", direction: "" }));
  const stations = useMemo(() => stationChoices(lines, stationQuery), [lines, stationQuery]);
  const matches = matchingLines(chosenStation, lineQuery);
  const selected = chosenStation?.matches.find(match => match.line.id === chosenLine);
  const editLine = lines.find(line => line.id === editing?.railway);
  const editStation = editLine?.stations.find(station => station.id === editing?.station);
  const availableDirections = [...new Set([...(editStation?.directions ?? []), ...settings.selectedRoutes.filter(route => editing && routeGroupKey(route) === routeGroupKey(editing)).map(route => route.direction)])];
  const directionLabel = (direction: string) => editStation?.directionNames?.[direction] ?? editLine?.directionNames?.[direction]
    ?? lines.flatMap(line => line.stations).find(station => station.id.split(".").at(-1) === direction.split(".").at(-1))?.name ?? direction.split(".").at(-1);
  const alreadyAdded = !!selected && settings.selectedRoutes.some(route => routeGroupKey(route) === `${selected.line.id}|${selected.station.id}`);

  useEffect(() => {
    const dialogs = [addDialog.current, editDialog.current];
    return () => { for (const dialog of dialogs) if (dialog?.open) dialog.close(); };
  }, []);

  function chooseStation(choice: StationChoice) {
    setChosenStation(choice); setChosenLine(choice.matches.length === 1 ? choice.matches[0].line.id : ""); setLineQuery("");
  }

  function openEdit(group: SelectedRoute[]) {
    setEditing(group[0]); setDirections(group.map(route => route.direction));
    setOptions(routeDisplaySettings(group[0], settings.directionDisplayMode));
    editDialog.current?.showModal();
  }
  function add() {
    if (disabled || !selected?.station.directions.length) return;
    const key = `${selected.line.id}|${selected.station.id}`;
    if (!settings.selectedRoutes.some(route => routeGroupKey(route) === key)) {
      onChange({ ...settings, selectedRoutes: [...settings.selectedRoutes,
        ...[...new Set(selected.station.directions)].map(direction => ({ railway: selected.line.id, station: selected.station.id, direction, stationLocation: selected.station.location }))] });
    }
    addDialog.current?.close();
  }
  function apply() {
    if (!editing || !directions.length || disabled) return;
    const key = routeGroupKey(editing);
    const routes: SelectedRoute[] = [];
    let inserted = false;
    for (const route of settings.selectedRoutes) {
      if (routeGroupKey(route) !== key) routes.push(route);
      else if (!inserted) {
        routes.push(...[...new Set(directions)].map(direction => ({ ...settings.selectedRoutes.find(r => routeGroupKey(r) === key && r.direction === direction), railway: editing.railway, station: editing.station, direction, stationLocation: editStation?.location ?? editing.stationLocation, display: options })));
        inserted = true;
      }
    }
    onChange({ ...settings, selectedRoutes: routes });
    editDialog.current?.close();
  }
  return <>
    <div className="section-heading"><b>路線</b><i /><button type="button" className="add-route" disabled={disabled || !lines.length} onClick={() => {
      setStationQuery(""); setLineQuery(""); setPickerMode("search"); setVisibleCount(120); setChosenStation(undefined); setChosenLine(""); addDialog.current?.showModal();
    }}>＋ 路線を追加する</button></div>
    <div className="route-strip" aria-label="登録した路線">{groupRoutes(settings.selectedRoutes).map(group => {
      const route = group[0], line = lines.find(item => item.id === route.railway);
      const station = line?.stations.find(item => item.id === route.station);
      return <button type="button" key={routeGroupKey(route)} className="route-card" disabled={disabled} onClick={() => openEdit(group)}
        style={{ "--route-color": railwayColor(route.railway) } as React.CSSProperties}>
        <img src={railwayAsset(route.railway)} alt="" /><span><strong>{line?.name ?? route.railway.split(".").at(-1)}</strong>
          <small>{station?.name ?? route.station.split(".").at(-1)} · {group.length}方面</small></span><b aria-hidden="true">⚙</b>
      </button>;
    })}{!settings.selectedRoutes.length && <p className="muted">表示する駅・路線を追加してください。</p>}</div>
    {createPortal(<dialog className="route-dialog" ref={addDialog} aria-labelledby="add-route-title" onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
    }}>
      <div className="dialog-head"><h2 id="add-route-title">路線を追加</h2><button type="button" aria-label="閉じる" onClick={() => addDialog.current?.close()}>×</button></div>
      <div className="station-picker-tabs" role="tablist" aria-label="駅・停留所の選び方">{([ ["search", "駅名から選ぶ"], ["map", "マップから選ぶ"] ] as const).map(([value, label]) => <button
        key={value} id={`${pickerId}-${value}-tab`} type="button" role="tab" aria-selected={pickerMode === value} aria-controls={`${pickerId}-${value}-panel`}
        tabIndex={pickerMode === value ? 0 : -1} onClick={() => setPickerMode(value)} onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const next = value === "map" ? "search" : "map"; setPickerMode(next); document.getElementById(`${pickerId}-${next}-tab`)?.focus(); }
        }}>{label}</button>)}</div>
      <label>1. 駅・停留所を検索<input type="search" value={stationQuery} onChange={event => { setStationQuery(event.target.value); setVisibleCount(120); setChosenStation(undefined); setChosenLine(""); }} placeholder="駅名・駅番号で検索" /></label>
      {pickerMode === "search" ? <div role="tabpanel" id={`${pickerId}-search-panel`} aria-labelledby={`${pickerId}-search-tab`}>
      <p className="muted" role="status">{stations.length}件中 {Math.min(visibleCount, stations.length)}件を表示</p>
      <div className="search-results station-results" aria-label="駅・停留所の候補">{stations.slice(0, visibleCount).map(choice => <button type="button" key={choice.name}
        className={chosenStation?.name === choice.name ? "selected" : ""} aria-pressed={chosenStation?.name === choice.name}
        onClick={() => chooseStation(choice)}>
        <strong>{choice.name}</strong><small>{choice.matches.map(match => match.line.name).join(" / ")}</small>
      </button>)}{!stations.length && <p>該当する駅・停留所がありません。</p>}</div>
      {stations.length > visibleCount && <button type="button" className="catalog-more" onClick={() => setVisibleCount(count => count + 120)}>続きを表示（残り{stations.length - visibleCount}件）</button>}
      </div> : <div role="tabpanel" id={`${pickerId}-map-panel`} aria-labelledby={`${pickerId}-map-tab`}><StationMap stations={stations} selected={chosenStation} onSelect={chooseStation} /></div>}
      {chosenStation && <p className="station-choice-summary"><strong>{chosenStation.name}</strong><span>{chosenStation.matches.length}路線・系統から選択できます</span></p>}
      <label>2. 路線を検索<input type="search" value={lineQuery} disabled={!chosenStation} onChange={event => setLineQuery(event.target.value)} placeholder={chosenStation ? `${chosenStation.name}の路線を検索` : "先に駅・停留所を選択してください"} /></label>
      <div className="search-results line-results" aria-label="路線の候補">{matches.map(({ line }) => <button type="button" key={line.id} className={chosenLine === line.id ? "selected" : ""}
        aria-pressed={chosenLine === line.id} onClick={() => setChosenLine(line.id)}><img src={railwayAsset(line.id)} alt="" /><strong>{line.name}</strong></button>)}
        {chosenStation && !matches.length && <p>該当する路線がありません。</p>}</div>
      {selected && <p className="muted">{alreadyAdded ? "この駅・路線は登録済みです。路線カードから方面や表示項目を設定できます。" : "表示する方面や表示項目は、追加後に路線カードをタップして設定できます。"}</p>}
      <div className="dialog-actions"><button type="button" onClick={() => addDialog.current?.close()}>キャンセル</button><button type="button" className="primary" disabled={disabled || alreadyAdded || !selected?.station.directions.length} onClick={add}>{alreadyAdded ? "追加済み" : "追加する"}</button></div>
    </dialog>, document.body)}
    {createPortal(<dialog className="route-dialog" ref={editDialog} aria-labelledby="route-settings-title">
      <div className="dialog-head"><h2 id="route-settings-title">路線の表示設定</h2><button type="button" aria-label="閉じる" onClick={() => editDialog.current?.close()}>×</button></div>
      <p>{editStation?.name} · {editLine?.name}</p>
      <fieldset className="route-fields" disabled={disabled}><legend>表示する方面</legend>
        {availableDirections.map(direction => <label className="check-row" key={direction}><input type="checkbox" checked={directions.includes(direction)} onChange={event => setDirections(old => event.target.checked ? [...old, direction] : old.filter(item => item !== direction))} />{directionLabel(direction)}方面</label>)}
        {!directions.length && <p className="feedback error">少なくとも1方面を選択してください。</p>}
      </fieldset>
      <label>方面の表示方法<select disabled={disabled} value={options.directionDisplayMode} onChange={event => setOptions(old => ({ ...old, directionDisplayMode: event.target.value as "separate" | "combined" }))}>
        <option value="separate">方面ごとに切り替えて表示</option><option value="combined">両方面を1つの画面に表示</option></select></label>
      <fieldset className="route-fields" disabled={disabled}><legend>表示する項目</legend>
        {([["showLineName", "路線名"], ["showDirection", "方面表示"], ["showTrainType", "種別"], ["showCarCount", "両数"]] as const).map(([key, text]) => <label className="check-row" key={key}>
          <input type="checkbox" checked={options[key]} disabled={key === "showCarCount" && !editLine?.supportsCarCount && !options.showCarCount} onChange={event => setOptions(old => ({ ...old, [key]: event.target.checked }))} />{text}
          {key === "showCarCount" && !editLine?.supportsCarCount && <small>この路線は両数情報を取得できません</small>}
        </label>)}
      </fieldset>
      <div className="dialog-actions"><button type="button" className="danger route-delete" disabled={disabled} onClick={() => { if (editing) onChange({ ...settings, selectedRoutes: settings.selectedRoutes.filter(route => routeGroupKey(route) !== routeGroupKey(editing)) }); editDialog.current?.close(); }}>路線を削除</button>
        <button type="button" onClick={() => editDialog.current?.close()}>キャンセル</button><button type="button" className="primary" disabled={disabled || !directions.length} onClick={apply}>適用する</button></div>
    </dialog>, document.body)}
  </>;
}
