import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale } from "./i18n";
import {
  Copy,
  Download,
  FileText,
  History,
  ImageDown,
  LayoutGrid,
  MapPinned,
  Palette,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { LicensePage } from "./LicensePage";
import { PrivacyPage } from "./PrivacyPage";
import { Logo } from "./Logo";
import { MapView, type MapHandle, type PinStyleOptions } from "./MapView";
import { searchPlace, parseCoordinates, type SearchResult } from "./nominatim";
import {
  centerOfBbox,
  clearRecents,
  formatCoords,
  formatRecentCopyText,
  loadRecents,
  pushRecent,
  type RecentLocation,
} from "./recents";
import { SettingsModal } from "./SettingsModal";
import { StyleSelect } from "./StyleSelect";
import { downloadBlob, downloadSvg, generateStyledSvg } from "./svg";
import { DEFAULT_STYLE_ID, getStyleDef, type MapStyleId } from "./theme";
import type { BBox } from "./types";
import { PRINT_SIZES, type PngExportOptions } from "./pngExport";
import {
  boundsFromPins,
  createManualPin,
  getLabelFields,
  getLabelFieldCoverage,
  pinsToGeoJson,
  isPinFileName,
  parsePinInput,
  type Pin,
  type PinMetadata,
} from "./pins";

type UiTheme = "light" | "dark";

const DEFAULT_PIN_STYLE: PinStyleOptions = {
  radius: 7,
  fillColor: "#5b5bf2",
  strokeColor: "#ffffff",
  strokeWidth: 2,
  opacity: 0.9,
  scaleDuplicates: false,
  maxDuplicateScale: 3,
  labels: true,
  fontSize: 12,
  textColor: "#20202a",
  haloColor: "#ffffff",
  haloWidth: 1.5,
  labelGap: 6,
  labelPosition: "above",
  allowOverlap: false,
  duplicateSuffix: false,
};

function getInitialTheme(): UiTheme {
  if (typeof document === "undefined") return "light";
  return (document.documentElement.getAttribute("data-theme") as UiTheme) ?? "light";
}

export function App() {
  const { t } = useLocale();
  const mapRef = useRef<MapHandle>(null);

  const [route, setRoute] = useState<"app" | "license" | "privacy">(
    typeof window !== "undefined"
      ? window.location.hash === "#license" ? "license"
        : window.location.hash === "#privacy" ? "privacy"
        : "app"
      : "app",
  );
  const [uiTheme, setUiTheme] = useState<UiTheme>(getInitialTheme);
  const [panelTab, setPanelTab] = useState<"workspace" | "pins" | "history">("workspace");

  const [styleId, setStyleId] = useState<MapStyleId>(DEFAULT_STYLE_ID);
  const [hideLabels, setHideLabels] = useState(false);
  const [hideBuildings, setHideBuildings] = useState(false);
  const [roadsColor, setRoadsColor] = useState<string | null>(null);
  const [buildingsColor, setBuildingsColor] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const styleDef = useMemo(() => getStyleDef(styleId), [styleId]);
  const [nameQuery, setNameQuery] = useState("");
  const [coordQuery, setCoordQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [bbox, setBbox] = useState<BBox | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [pendingSearchCoords, setPendingSearchCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [recents, setRecents] = useState<RecentLocation[]>(() => loadRecents());
  const [exporting, setExporting] = useState(false);
  const [pngScale, setPngScale] = useState<1 | 2 | 3 | 4>(1);
  const [pngPreset, setPngPreset] = useState<"scale" | "custom" | "a4" | "a3">("scale");
  const [printLandscape, setPrintLandscape] = useState(false);
  const [pngWidth, setPngWidth] = useState("2400");
  const [pngHeight, setPngHeight] = useState("1600");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [pinJson, setPinJson] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinMetadata, setPinMetadata] = useState<PinMetadata | null>(null);
  const [pinStyle, setPinStyle] = useState<PinStyleOptions>(DEFAULT_PIN_STYLE);
  const [pointCreation, setPointCreation] = useState(false);
  const [newPointLabel, setNewPointLabel] = useState("");
  const [manualPointIds, setManualPointIds] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      setRoute(hash === "#license" ? "license" : hash === "#privacy" ? "privacy" : "app");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", uiTheme);
    try {
      localStorage.setItem("gsmap-theme", uiTheme);
    } catch {
      // ignore storage failures so the app keeps rendering
    }
  }, [uiTheme]);

  useEffect(() => {
    if (panelTab !== "pins" || route !== "app") setPointCreation(false);
  }, [panelTab, route]);

  useEffect(() => {
    if (!pointCreation) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPointCreation(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pointCreation]);

  // Record search/coordinate origins as they arrive. Plain map selections are
  // recorded only once the user accepts the edit (see handleAcceptSelection),
  // so intermediate drag states never pollute the history.
  useEffect(() => {
    if (!bbox || (!pendingLabel && !pendingSearchCoords)) return;
    const center = pendingSearchCoords ?? centerOfBbox(bbox);
    setRecents((curr) =>
      pushRecent(curr, {
        bbox,
        label: pendingLabel ?? formatCoords(center.lat, center.lon),
        lat: center.lat,
        lon: center.lon,
        kind: "search",
      }),
    );
    setPendingLabel(null);
    setPendingSearchCoords(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox]);

  function handleAcceptSelection(accepted: BBox) {
    const center = centerOfBbox(accepted);
    setRecents((curr) =>
      pushRecent(curr, {
        bbox: accepted,
        label: formatCoords(center.lat, center.lon),
        lat: center.lat,
        lon: center.lon,
        kind: "selection",
      }),
    );
  }

  const effectiveRoadsColor = roadsColor ?? getStyleDef(styleId).tokens.roads;
  const effectiveBuildingsColor = buildingsColor ?? getStyleDef(styleId).tokens.buildings;
  const effectiveBackgroundColor = backgroundColor ?? getStyleDef(styleId).tokens.background;
  const pinLabelOptions = useMemo(
    () => getLabelFields(pins, pinMetadata?.coordinateFields ?? "lat/lon").map((field) => ({
      value: field,
      label: `${field} · ${getLabelFieldCoverage(pins, field)}/${pins.length}`,
    })),
    [pinMetadata, pins],
  );

  const dimsKm = useMemo(() => {
    if (!bbox) return null;
    const latMid = (bbox.north + bbox.south) / 2;
    const widthKm =
      ((bbox.east - bbox.west) * Math.PI * 6371 * Math.cos((latMid * Math.PI) / 180)) / 180;
    const heightKm = ((bbox.north - bbox.south) * Math.PI * 6371) / 180;
    return { widthKm, heightKm };
  }, [bbox]);

  async function runNameSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!nameQuery.trim()) return;
    setSearching(true);
    setStatusMsg(null);
    try {
      const results = await searchPlace(nameQuery.trim());
      setSearchResults(results);
      if (results.length === 0) {
        setStatusMsg(t.location.noResults);
        setStatusError(false);
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStatusError(true);
    } finally {
      setSearching(false);
    }
  }

  function applyResult(r: SearchResult) {
    const [south, north, west, east] = r.boundingbox;
    const b: BBox = { south, north, west, east };
    mapRef.current?.fitBbox(b);
    setPendingLabel(r.display_name);
    setPendingSearchCoords({ lat: r.lat, lon: r.lon });
    setBbox(b);
    setSearchResults([]);
  }

  // Re-applying a history entry only navigates the map; it must not record a
  // new entry (that would duplicate or reorder the very item being clicked).
  function applyRecent(r: RecentLocation) {
    if (r.bbox) {
      mapRef.current?.fitBbox(r.bbox);
    } else {
      mapRef.current?.flyTo(r.lon, r.lat, 15);
    }
    setPendingLabel(null);
    setPendingSearchCoords(null);
    setBbox(r.bbox ?? null);
  }

  function handleClearRecents() {
    setRecents(clearRecents());
  }

  function loadPinText(text: string) {
    try {
      const document = parsePinInput(text);
      setPins(document.pins);
      setManualPointIds([]);
      setPointCreation(false);
      setPinMetadata(document.metadata);
      setPinStyle((current) => ({ ...current, labelField: document.metadata.labelField }));
      setPinJson(text);
      setStatusMsg(null);
      setStatusError(false);
      const importedBounds = document.bounds ?? boundsFromPins(document.pins);
      if (importedBounds) {
        mapRef.current?.fitBbox(importedBounds);
        setBbox(importedBounds);
        if (document.pins.length === 1) {
          mapRef.current?.flyTo(document.pins[0].lon, document.pins[0].lat, 14);
        }
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStatusError(true);
    }
  }

  function handleLoadPins(e: React.FormEvent) {
    e.preventDefault();
    loadPinText(pinJson);
  }

  async function handlePinFile(file: File) {
    if (!isPinFileName(file.name)) {
      setStatusMsg(t.pins.chooseJson);
      setStatusError(true);
      return;
    }
    try {
      loadPinText(await file.text());
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStatusError(true);
    }
  }

  function handlePinDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0]; if (file) void handlePinFile(file);
  }

  function handleClearPins() {
    setPins([]);
    setManualPointIds([]);
    setPointCreation(false);
    setPinMetadata(null);
    setPinJson("");
    setPinStyle((current) => ({ ...current, labelField: undefined }));
    setStatusMsg(null);
    setStatusError(false);
  }

  function handleCreatePoint(point: { lat: number; lon: number }) {
    const label = newPointLabel.trim() || t.pins.newPoint(pins.length + 1);
    const id = `manual-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
    const pin = createManualPin(point, label, id, pinStyle.labelField);
    setPins((current) => [...current, pin]);
    setManualPointIds((current) => [...current, id]);
    if (!pinStyle.labelField) setPinStyle((current) => ({ ...current, labelField: "label" }));
    setStatusMsg(null);
    setStatusError(false);
  }

  function handleUndoPoint() {
    const id = manualPointIds.at(-1);
    if (!id) return;
    setPins((current) => current.filter((pin) => pin.id !== id));
    setManualPointIds((current) => current.slice(0, -1));
  }

  function handleSavePoints() {
    const data = JSON.stringify(pinsToGeoJson(pins), null, 2);
    downloadBlob(new Blob([data], { type: "application/geo+json" }), "gsmap2-points.geojson");
  }

  function handleClearSelection() {
    mapRef.current?.clearSelection();
    setBbox(null);
    setPendingLabel(null);
    setPendingSearchCoords(null);
    setStatusMsg(null);
    setStatusError(false);
  }

  function runCoordSearch(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseCoordinates(coordQuery);
    if (!parsed) {
      setStatusMsg(t.location.invalidCoords);
      setStatusError(true);
      return;
    }
    setStatusMsg(null);
    setRecents((curr) =>
      pushRecent(curr, {
        label: t.location.coordinates,
        lat: parsed.lat,
        lon: parsed.lon,
        kind: "coordinates",
      }),
    );
    mapRef.current?.flyTo(parsed.lon, parsed.lat, 15);
  }

  async function copyLocation(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 1400);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : t.selection.copyFailed);
      setStatusError(true);
    }
  }

  async function handleExportSvgLocal() {
    const map = mapRef.current;
    if (!bbox || !map) {
      setStatusMsg(t.export.selectAreaFirst);
      setStatusError(true);
      return;
    }
    setExporting(true);
    setStatusMsg(null);
    setStatusError(false);
    try {
      // hideLabels/hideBuildings already toggle layer visibility on the map, and
      // the styled collector skips layers with visibility:none, so the SVG
      // mirrors the current map without extra filtering. The collector also
      // frames the bbox first, so off-screen selections export fully.
      const styled = await map.getStyledFeatureSetForBbox(bbox);
      if (!styled) return;
      const svg = generateStyledSvg(styled);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadSvg(svg, `gsmap-local-${stamp}.svg`);
      setStatusMsg(null);
      setStatusError(false);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStatusError(true);
    } finally {
      setExporting(false);
    }
  }

  function getPngOptions(): PngExportOptions {
    if (pngPreset === "scale") return pngScale;
    if (pngPreset === "custom") return { width: Number(pngWidth), height: Number(pngHeight) };
    const size = PRINT_SIZES[pngPreset];
    return {
      width: printLandscape ? size.height : size.width,
      height: printLandscape ? size.width : size.height,
      dpi: 300,
    };
  }

  const pngOptions = getPngOptions();
  const pngSize = typeof pngOptions === "number"
    ? bbox ? mapRef.current?.getPngSize(bbox, pngOptions) : undefined
    : pngOptions;

  async function handleExportPng() {
    const map = mapRef.current;
    if (!map || !bbox) {
      setStatusMsg(t.export.selectAreaFirstPng);
      setStatusError(true);
      return;
    }
    setExporting(true);
    setPointCreation(false);
    setStatusMsg(t.export.exporting);
    setStatusError(false);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      const options = getPngOptions();
      const size = typeof options === "number" ? map.getPngSize(bbox, options) : options;
      const png = await map.captureSelectedPng(bbox, options);
      downloadBlob(png, `gsmap-selection-${stamp}-${size.width}x${size.height}.png`);
      setStatusMsg(null);
      setStatusError(false);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStatusError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={"app" + (route === "license" ? " app-license" : "")}>
      <aside className="nav-rail">
        <div className="nav-rail-top">
          <div className="nav-rail-brand">
            <Logo size={32} />
            <span className="brand-name">GSmap</span>
          </div>
          <RailItem
            active={route === "app" && panelTab === "workspace"}
            onClick={() => { setRoute("app"); setPanelTab("workspace"); window.location.hash = ""; }}
            icon={<LayoutGrid size={18} strokeWidth={1.9} />}
            label={t.nav.workspace}
          />
          <RailItem
            active={route === "app" && panelTab === "pins"}
            onClick={() => { setRoute("app"); setPanelTab("pins"); window.location.hash = ""; }}
            icon={<MapPinned size={18} strokeWidth={1.9} />}
            label={t.nav.pins}
          />
          <RailItem
            active={route === "app" && panelTab === "history"}
            onClick={() => { setRoute("app"); setPanelTab("history"); window.location.hash = ""; }}
            icon={<History size={18} strokeWidth={1.9} />}
            label={t.nav.history}
          />
          <RailItem
            active={route === "license"}
            onClick={() => { window.location.hash = "license"; setRoute("license"); }}
            icon={<ShieldCheck size={18} strokeWidth={1.9} />}
            label={t.nav.licensing}
          />
          <RailItem
            active={route === "privacy"}
            onClick={() => { window.location.hash = "privacy"; setRoute("privacy"); }}
            icon={<FileText size={18} strokeWidth={1.9} />}
            label={t.nav.privacy}
          />
        </div>

        <div className="nav-rail-bottom">
          <motion.button
            type="button"
            className="rail-item rail-item-settings"
            onClick={() => setSettingsOpen(true)}
            whileHover={{ y: -1 }}
            whileTap={{ y: 1 }}
            transition={{ duration: 0.12 }}
          >
            <Settings size={16} strokeWidth={1.9} />
            <span>{t.nav.settings}</span>
          </motion.button>
        </div>
      </aside>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        uiTheme={uiTheme}
        onChangeTheme={setUiTheme}
      />

      {route === "app" && <aside className="panel">
        <div className="panel-header">
          <div>
            <h1 className="panel-title">
              {panelTab === "workspace" ? t.panel.workspace : panelTab === "pins" ? t.nav.pins : t.panel.history}
            </h1>
            <div className="panel-subtitle">
              {panelTab === "workspace"
                ? t.panel.subtitleWorkspace
                : panelTab === "pins" ? t.panel.subtitlePins : t.panel.subtitleHistory(recents.length)}
            </div>
          </div>
        </div>
        <div className="panel-main">
          <div className="panel-body">
            {panelTab === "workspace" && <>
              <PanelSection title={t.location.sectionTitle} icon={Search}>
                  <form className="stack-sm" onSubmit={runNameSearch}>
                    <TextFieldAction
                      label={t.location.searchByName}
                      placeholder={t.location.searchPlaceholder}
                      value={nameQuery}
                      onChange={setNameQuery}
                      actionLabel={t.location.findAction}
                      busy={searching}
                    />
                    <AnimatePresence>
                      {searchResults.length > 0 && (
                        <motion.div
                          className="results"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        >
                          {searchResults.map((r, i) => (
                            <motion.button
                              key={i}
                              className="result"
                              type="button"
                              onClick={() => applyResult(r)}
                              initial={{ opacity: 0, x: -4 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.025, duration: 0.16 }}
                            >
                              {r.display_name}
                            </motion.button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </form>

                  <form className="stack-sm" onSubmit={runCoordSearch}>
                    <TextFieldAction
                      label={t.location.coordinates}
                      placeholder={t.location.coordPlaceholder}
                      value={coordQuery}
                      onChange={setCoordQuery}
                      actionLabel={t.location.goAction}
                    />
                  </form>
                </PanelSection>

            </>}

            {panelTab === "pins" && <>
                <PanelSection title={t.pins.sectionTitle} icon={MapPinned}>
                  <form className="stack-sm" onSubmit={handleLoadPins}>
                    <label className="field-label" htmlFor="pin-json">{t.pins.jsonLabel}</label>
                    <div className="pin-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handlePinDrop}>
                      <textarea
                      id="pin-json"
                      className="input pin-json-input"
                      value={pinJson}
                      onChange={(e) => setPinJson(e.target.value)}
                      placeholder={t.pins.placeholder}
                      spellCheck={false}
                    />
                    </div>
                    <div className="pin-file-row">
                      <label className="mini-action pin-file-button" htmlFor="pin-file">{t.pins.chooseJson}</label>
                      <input id="pin-file" type="file" accept=".json,.geojson,application/json,application/geo+json" className="visually-hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handlePinFile(file); e.target.value = ""; }} />
                      {pinMetadata && <span className="pin-meta">{pinMetadata.format} · {pinMetadata.coordinateFields}{pinMetadata.labelField ? ` · ${t.pins.detectedLabel}: ${pinMetadata.labelField}` : ""}</span>}
                    </div>
                    <div className="pin-actions">
                      <button className="mini-action" type="submit">{t.pins.load}</button>
                      <button className="mini-action" type="button" onClick={handleClearPins}>{t.pins.clear}</button>
                      <span className="pin-count">{t.pins.count(pins.length)}</span>
                    </div>
                  </form>
                </PanelSection>

                <PanelSection title={t.pins.createTitle} icon={MapPinned}>
                  <label className="field-group" htmlFor="new-point-label">
                    <span className="field-label">{t.pins.nextLabel}</span>
                    <input id="new-point-label" className="input" value={newPointLabel} onChange={(e) => setNewPointLabel(e.target.value)} placeholder={t.pins.optionalLabel} maxLength={200} />
                  </label>
                  <div className="pin-actions pin-create-actions">
                    <button className={"mini-action" + (pointCreation ? " mini-action--accent" : "")} type="button" aria-pressed={pointCreation} onClick={() => setPointCreation((current) => !current)} disabled={exporting}>
                      {pointCreation ? t.pins.stopCreating : t.pins.startCreating}
                    </button>
                    <button className="mini-action" type="button" onClick={handleUndoPoint} disabled={!manualPointIds.length || exporting}>
                      <Undo2 size={13} />{t.pins.undoPoint}
                    </button>
                  </div>
                  <p className="control-hint">{pointCreation ? t.pins.createHint : t.pins.createDescription}</p>
                  <button className="mini-action" type="button" onClick={handleSavePoints} disabled={!pins.length}>
                    <Download size={13} />{t.pins.savePoints}
                  </button>
                </PanelSection>

                <PanelSection title={t.pins.styleTitle} icon={Palette}>
                  <div className="pin-style-group">
                    <div className="pin-style-heading">{t.pins.pointSettings}</div>
                    <div className="pin-control-grid">
                      <PinNumber label={t.pins.radius} value={pinStyle.radius} min={1} max={24} step={1} onChange={(radius) => setPinStyle((s) => ({ ...s, radius }))} />
                      <PinNumber label={t.pins.strokeWidth} value={pinStyle.strokeWidth} min={0} max={8} step={0.5} onChange={(strokeWidth) => setPinStyle((s) => ({ ...s, strokeWidth }))} />
                      <PinNumber label={t.pins.opacity} value={pinStyle.opacity} min={0} max={1} step={0.05} onChange={(opacity) => setPinStyle((s) => ({ ...s, opacity }))} />
                      {pinStyle.scaleDuplicates && (
                        <PinNumber label={t.pins.maxScale} value={pinStyle.maxDuplicateScale} min={1} max={5} step={0.1} onChange={(maxDuplicateScale) => setPinStyle((s) => ({ ...s, maxDuplicateScale }))} />
                      )}
                    </div>
                    <PinColor label={t.pins.fillColor} value={pinStyle.fillColor} onChange={(fillColor) => setPinStyle((s) => ({ ...s, fillColor }))} />
                    <PinColor label={t.pins.strokeColor} value={pinStyle.strokeColor} onChange={(strokeColor) => setPinStyle((s) => ({ ...s, strokeColor }))} />
                    <SwitchRow label={t.pins.scaleDuplicates} checked={pinStyle.scaleDuplicates} onChange={(scaleDuplicates) => setPinStyle((s) => ({ ...s, scaleDuplicates }))} />
                  </div>

                  <div className="pin-style-group">
                    <div className="pin-style-heading">{t.pins.labelSettings}</div>
                    <SwitchRow label={t.pins.showLabels} checked={pinStyle.labels} onChange={(labels) => setPinStyle((s) => ({ ...s, labels }))} />
                    {pinStyle.labels && (
                      <>
                        <PinSelect
                          label={t.pins.labelField}
                          value={pinStyle.labelField ?? ""}
                          options={pinLabelOptions}
                          emptyLabel={t.pins.noLabel}
                          onChange={(labelField) => setPinStyle((s) => ({ ...s, labelField: labelField || undefined }))}
                        />
                        <div className="pin-control-grid">
                          <PinNumber label={t.pins.fontSize} value={pinStyle.fontSize} min={6} max={32} step={1} onChange={(fontSize) => setPinStyle((s) => ({ ...s, fontSize }))} />
                          <PinNumber label={t.pins.labelGap} value={pinStyle.labelGap} min={0} max={30} step={1} onChange={(labelGap) => setPinStyle((s) => ({ ...s, labelGap }))} />
                          <PinNumber label={t.pins.haloWidth} value={pinStyle.haloWidth} min={0} max={10} step={0.5} onChange={(haloWidth) => setPinStyle((s) => ({ ...s, haloWidth }))} />
                        </div>
                        <PinColor label={t.pins.textColor} value={pinStyle.textColor} onChange={(textColor) => setPinStyle((s) => ({ ...s, textColor }))} />
                        <PinColor label={t.pins.haloColor} value={pinStyle.haloColor} onChange={(haloColor) => setPinStyle((s) => ({ ...s, haloColor }))} />
                        <PinSelect
                          label={t.pins.position}
                          value={pinStyle.labelPosition}
                          options={[
                            { value: "above", label: t.pins.positionAbove },
                            { value: "right", label: t.pins.positionRight },
                            { value: "below", label: t.pins.positionBelow },
                            { value: "left", label: t.pins.positionLeft },
                          ]}
                          onChange={(labelPosition) => setPinStyle((s) => ({
                            ...s,
                            labelPosition: labelPosition as PinStyleOptions["labelPosition"],
                          }))}
                        />
                        <SwitchRow label={t.pins.allowOverlap} checked={pinStyle.allowOverlap} onChange={(allowOverlap) => setPinStyle((s) => ({ ...s, allowOverlap }))} />
                        <SwitchRow label={t.pins.duplicateSuffix} checked={pinStyle.duplicateSuffix} onChange={(duplicateSuffix) => setPinStyle((s) => ({ ...s, duplicateSuffix }))} />
                      </>
                    )}
                  </div>
                </PanelSection>

            </>}

            {panelTab === "workspace" && <>
                <PanelSection
                  title={t.selection.sectionTitle}
                  icon={MapPinned}
                  action={bbox ? <span className="selection-pulse">{t.selection.active}</span> : undefined}
                >
                  {!bbox && (
                    <div className="empty-state">
                      <div>
                        {t.selection.hint} <span className="kbd">{t.selection.hintKey}</span> {t.selection.hintSuffix}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                        {t.selection.hintDetail}
                      </div>
                    </div>
                  )}
                  {bbox && (
                    <>
                      <dl className="kv">
                        <dt>{t.selection.center}</dt>
                        <dd>
                          {((bbox.north + bbox.south) / 2).toFixed(5)},{" "}
                          {((bbox.east + bbox.west) / 2).toFixed(5)}
                        </dd>
                        <dt>{t.selection.sw}</dt>
                        <dd>{bbox.south.toFixed(5)}, {bbox.west.toFixed(5)}</dd>
                        <dt>{t.selection.ne}</dt>
                        <dd>{bbox.north.toFixed(5)}, {bbox.east.toFixed(5)}</dd>
                        {dimsKm && (
                          <>
                            <dt>{t.selection.size}</dt>
                            <dd>
                              {dimsKm.widthKm.toFixed(2)} x {dimsKm.heightKm.toFixed(2)} km
                            </dd>
                          </>
                        )}
                      </dl>
                      <div className="location-actions">
                        <button
                          type="button"
                          className="mini-action"
                          onClick={handleClearSelection}
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          {t.selection.clearSelection}
                        </button>
                        <button
                          type="button"
                          className={"mini-action" + (copiedKey === "current-selection" ? " copied" : "")}
                          onClick={() =>
                            copyLocation(
                              "current-selection",
                              `Selected area - ${formatCoords(
                                (bbox.north + bbox.south) / 2,
                                (bbox.east + bbox.west) / 2,
                              )}`,
                            )
                          }
                        >
                          <Copy size={13} strokeWidth={2} />
                          {copiedKey === "current-selection" ? t.selection.copied : t.selection.copyLocation}
                        </button>
                      </div>
                    </>
                  )}
                </PanelSection>

                <PanelSection title={t.style.sectionTitle} icon={Palette}>
                  <StyleSelect
                    value={styleId}
                    onChange={setStyleId}
                    ariaLabel={t.style.mapStyle}
                  />
                  <SwitchRow
                    label={t.style.hideLabels}
                    checked={hideLabels}
                    onChange={setHideLabels}
                  />
                  <SwitchRow
                    label={t.style.hideBuildings}
                    checked={hideBuildings}
                    onChange={setHideBuildings}
                  />
                  <div className="roads-color-row">
                    <label htmlFor="roads-color-input" className="roads-color-label">
                      {t.style.roadsColor}
                    </label>
                    <input
                      id="roads-color-input"
                      type="color"
                      className="roads-color-input"
                      value={effectiveRoadsColor}
                      onChange={(e) => setRoadsColor(e.target.value)}
                      aria-label={t.style.roadsColor}
                    />
                    {roadsColor && (
                      <button
                        type="button"
                        className="roads-color-reset"
                        onClick={() => setRoadsColor(null)}
                      >
                        {t.style.reset}
                      </button>
                    )}
                  </div>
                  <div className="roads-color-row">
                    <label htmlFor="buildings-color-input" className="roads-color-label">
                      {t.style.buildingsColor}
                    </label>
                    <input
                      id="buildings-color-input"
                      type="color"
                      className="roads-color-input"
                      value={effectiveBuildingsColor}
                      onChange={(e) => setBuildingsColor(e.target.value)}
                      aria-label={t.style.buildingsColor}
                    />
                    {buildingsColor && (
                      <button
                        type="button"
                        className="roads-color-reset"
                        onClick={() => setBuildingsColor(null)}
                      >
                        {t.style.reset}
                      </button>
                    )}
                  </div>
                  <div className="roads-color-row">
                    <label htmlFor="background-color-input" className="roads-color-label">
                      {t.style.backgroundColor}
                    </label>
                    <input
                      id="background-color-input"
                      type="color"
                      className="roads-color-input"
                      value={effectiveBackgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      aria-label={t.style.backgroundColor}
                    />
                    {backgroundColor && (
                      <button
                        type="button"
                        className="roads-color-reset"
                        onClick={() => setBackgroundColor(null)}
                      >
                        {t.style.reset}
                      </button>
                    )}
                  </div>
                </PanelSection>
            </>}

            {panelTab === "history" && (
              <PanelSection
                title={t.historySection.sectionTitle}
                icon={History}
                action={
                  <button
                    type="button"
                    className="section-action"
                    onClick={handleClearRecents}
                    aria-label={t.historySection.clearHistory}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                }
              >
                {recents.length > 0 ? (
                  <motion.div
                    className="recents"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18 }}
                  >
                    {recents.map((r, i) => (
                      <motion.div
                        key={i}
                        className="recent-card"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.025, duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <button
                          type="button"
                          className="recent-item"
                          onClick={() => applyRecent(r)}
                          title={r.label}
                        >
                          <span className="recent-label">{r.label}</span>
                          <span className="recent-meta">
                            {r.kind === "search" ? t.historySection.kindSearch : r.kind === "coordinates" ? t.historySection.kindCoordinates : t.historySection.kindSelection}
                          </span>
                          <span className="recent-coords">{formatCoords(r.lat, r.lon)}</span>
                        </button>
                        <button
                          type="button"
                          className={"mini-action" + (copiedKey === `recent-${i}` ? " copied" : "")}
                          onClick={() => copyLocation(`recent-${i}`, formatRecentCopyText(r))}
                        >
                          <Copy size={13} strokeWidth={2} />
                          {copiedKey === `recent-${i}` ? t.historySection.copied : t.historySection.copy}
                        </button>
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <div className="empty-state">
                    <div>{t.historySection.noHistory}</div>
                    <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                      {t.historySection.noHistoryDetail}
                    </div>
                  </div>
                )}
              </PanelSection>
            )}
          </div>
        </div>

        <div className="panel-bottom">
          <div className="export-dock">
            <div className="export-header">
              <span className="export-title">{t.export.sectionTitle}</span>
              <span className={"export-state" + (bbox ? " export-state-ready" : "")}>
                {bbox ? t.export.areaSelected : t.export.selectArea}
              </span>
            </div>
            <button
              className="btn btn-primary export-primary export-png-btn"
              type="button"
              onClick={handleExportPng}
              disabled={exporting || !bbox}
            >
              {exporting ? (
                <>
                  <span className="spinner" />
                  {t.export.exporting}
                </>
              ) : (
                <>
                  <ImageDown size={15} strokeWidth={2} />
                  {t.export.exportPng}
                </>
              )}
            </button>
            <details className="png-options">
              <summary>{t.export.pngSize}{pngSize ? ` · ${pngSize.width} × ${pngSize.height} px` : ""}</summary>
              <div className="stack-sm">
                <label className="field-group" htmlFor="png-preset">
                  <span className="field-label">{t.export.sizeMode}</span>
                  <select id="png-preset" className="select" value={pngPreset} onChange={(e) => setPngPreset(e.target.value as typeof pngPreset)} disabled={exporting}>
                    <option value="scale">{t.export.quickScale}</option>
                    <option value="custom">{t.export.customSize}</option>
                    <option value="a4">A4 · 300 DPI</option>
                    <option value="a3">A3 · 300 DPI</option>
                  </select>
                </label>
                {pngPreset === "scale" && <label className="field-group">
                  <span className="field-label">{t.export.pngAriaLabel}</span>
                  <select className="select export-png-scale" value={pngScale} onChange={(e) => setPngScale(Number(e.target.value) as 1 | 2 | 3 | 4)} disabled={exporting}>
                    <option value={1}>1x</option><option value={2}>2x</option><option value={3}>3x</option><option value={4}>4x</option>
                  </select>
                </label>}
                {pngPreset === "custom" && <div className="pin-control-grid">
                  <label className="field-group" htmlFor="png-width"><span className="field-label">{t.export.widthPx}</span><input id="png-width" className="input" type="number" min={1} step={1} value={pngWidth} onChange={(e) => setPngWidth(e.target.value)} disabled={exporting} /></label>
                  <label className="field-group" htmlFor="png-height"><span className="field-label">{t.export.heightPx}</span><input id="png-height" className="input" type="number" min={1} step={1} value={pngHeight} onChange={(e) => setPngHeight(e.target.value)} disabled={exporting} /></label>
                </div>}
                {(pngPreset === "a4" || pngPreset === "a3") && <label className="field-group">
                  <span className="field-label">{t.export.orientation}</span>
                  <select id="png-orientation" className="select" value={printLandscape ? "landscape" : "portrait"} onChange={(e) => setPrintLandscape(e.target.value === "landscape")} disabled={exporting}>
                    <option value="portrait">{t.export.portrait}</option><option value="landscape">{t.export.landscape}</option>
                  </select>
                </label>}
                <p className="control-hint">{pngPreset === "scale" ? t.export.scaleHint : t.export.fitHint}</p>
              </div>
            </details>
            <button className="mini-action export-svg-btn" type="button" onClick={handleExportSvgLocal} disabled={exporting || !bbox}>
              <Download size={13} />{t.export.localSvg}
            </button>
            <p className="control-hint">{t.export.svgHint}</p>
            {statusMsg && (
              <div
                className={"status export-status" + (statusError ? " status-error" : "")}
                role="status"
              >
                {exporting && !statusError && <span className="spinner" />}
                {statusMsg}
              </div>
            )}
          </div>

          <footer className="app-footer">
            <div>
              {t.footer.mapData}{" "}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>{" "}
              {t.footer.contributors} {styleDef.attribution}.
            </div>
          </footer>
        </div>
      </aside>}

      {route === "app" && (
        <MapView
          ref={mapRef}
          styleId={styleId}
          hideLabels={hideLabels}
          hideBuildings={hideBuildings}
          roadsColor={roadsColor}
          buildingsColor={buildingsColor}
          backgroundColor={backgroundColor}
          editLabels={{
            accept: t.selection.accept,
            revert: t.selection.revert,
            hint: t.selection.editHint,
          }}
          onSelect={setBbox}
          onAcceptSelection={handleAcceptSelection}
          pins={pins}
          pinStyle={pinStyle}
          pointCreation={pointCreation && !exporting}
          onCreatePoint={handleCreatePoint}
          pointCreationHint={t.pins.createHint}
        />
      )}
      <AnimatePresence mode="wait">
        {route === "license" && (
          <motion.div
            key="license"
            className="license-shell"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <LicensePage
              embedded
              uiTheme={uiTheme}
              onToggleTheme={() => setUiTheme((t) => (t === "dark" ? "light" : "dark"))}
              onBack={() => { window.location.hash = ""; setRoute("app"); }}
            />
          </motion.div>
        )}
        {route === "privacy" && (
          <motion.div
            key="privacy"
            className="license-shell"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <PrivacyPage
              embedded
              uiTheme={uiTheme}
              onToggleTheme={() => setUiTheme((t) => (t === "dark" ? "light" : "dark"))}
              onBack={() => { window.location.hash = ""; setRoute("app"); }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PinNumber({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="pin-number">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}
function PinColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="roads-color-row"><span className="roads-color-label">{label}</span><input type="color" className="roads-color-input" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function PinSelect({
  label,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  emptyLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="pin-select">
      <span className="field-label">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

type RailItemProps = {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
};

function RailItem({ active, onClick, icon, label }: RailItemProps) {
  return (
    <motion.button
      type="button"
      className={"rail-item" + (active ? " rail-item-active" : "")}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ y: 1 }}
      transition={{ duration: 0.12 }}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

type PanelSectionProps = {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
};

function PanelSection({ title, icon: Icon, action, children }: PanelSectionProps) {
  return (
    <motion.section
      className="section section-card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="section-title">
        <span className="section-heading">
          <Icon size={14} strokeWidth={2} />
          {title}
        </span>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

type TextFieldActionProps = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  actionLabel: string;
  busy?: boolean;
};

function TextFieldAction({
  label,
  placeholder,
  value,
  onChange,
  actionLabel,
  busy = false,
}: TextFieldActionProps) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      <span className="field-action">
        <input
          className="input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button className="btn field-action-button" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : actionLabel}
        </button>
      </span>
    </div>
  );
}

type SwitchRowProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function SwitchRow({ label, checked, onChange }: SwitchRowProps) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}

