'use strict';
/**
 * Haltepunkte der Struktogramme als echte VS-Code-Haltepunkte (Ansicht „Haltepunkte“, aktivieren/deaktivieren,
 * Bedingung, Trefferzahl, Logpoint, Funktionshaltepunkte; VS Code speichert sie).
 *
 * VS Code verwaltet Haltepunkte zeilenweise. Eine .nsd-Datei ist XML mit einem Element je Zeile – ein Haltepunkt
 * gehört zu dem Element, dessen Tag in seiner Zeile beginnt (elementLines). VS Code ist die einzige Quelle:
 * F9 im Diagramm setzt/entfernt einen VS-Code-Haltepunkt, jede Änderung geht an Diagramm und Ausführung.
 */
const vscode = require('vscode');
const { elementLines, fromNsd } = require('./core/nsdxml');
const P = require('./core/pseudo');
const { t } = require('./i18n');

const isRoot = (path) => /^roots\/\d+$/.test(path);

class BreakpointSync {
  constructor(context, editors) {
    this.editors = editors;
    this.maps = new Map();  // URI -> { version, pathToLine, lineToPath }
    this.prev = new Map();  // URI -> Zuordnung der vorherigen Version (zum Nachführen nach Änderungen)
    context.subscriptions.push(
      vscode.debug.onDidChangeBreakpoints(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument((e) => this.onEdit(e)),
    );
  }

  /** Zeilen-Zuordnung der aktuellen Fassung eines Dokuments */
  mapFor(document) {
    const key = document.uri.toString();
    let m = this.maps.get(key);
    if (!m || m.version !== document.version) {
      if (m) this.prev.set(key, m);
      try { m = elementLines(document.getText()); } catch (e) { m = { pathToLine: new Map(), lineToPath: new Map() }; }
      m.version = document.version;
      this.maps.set(key, m);
    }
    return m;
  }

  sourceBreakpoints(document) {
    const key = document.uri.toString();
    return vscode.debug.breakpoints.filter((b) => b instanceof vscode.SourceBreakpoint && b.location.uri.toString() === key);
  }

  /** Element zu einer Zeile (null: kein Element oder Diagrammkopf) */
  pathAt(document, line) {
    const path = this.mapFor(document).lineToPath.get(line);
    return path && !isRoot(path) ? path : null;
  }

  /** Haltepunkte eines Dokuments: aktive (mit Bedingung usw.) und deaktivierte */
  collect(document) {
    const active = [], disabled = [];
    for (const b of this.sourceBreakpoints(document)) {
      const path = this.pathAt(document, b.location.range.start.line);
      if (!path) continue;
      const item = { path, condition: b.condition || undefined, hitCondition: b.hitCondition || undefined, logMessage: b.logMessage || undefined };
      (b.enabled ? active : disabled).push(item);
    }
    return { active, disabled };
  }

  /** aktive Funktionshaltepunkte (Namen von Unterprogrammen) */
  functions() {
    return vscode.debug.breakpoints.filter((b) => b instanceof vscode.FunctionBreakpoint && b.enabled).map((b) => b.functionName);
  }

  /** Anzeige im Diagramm und Ausführung auf den aktuellen Stand bringen */
  push(state) {
    if (!this.editors.editors.has(state)) return;
    const { active, disabled } = this.collect(state.document);
    const kind = (b) => (b.logMessage ? 'log' : b.condition || b.hitCondition ? 'cond' : 'bp');
    state.panel.webview.postMessage({ type: 'breakpoints', active: active.map((b) => ({ path: b.path, kind: kind(b) })), disabled: disabled.map((b) => b.path) });
    if (state.exec) state.exec.setDebug({ breakpoints: active, functions: this.functions() });
  }

  refreshAll() { for (const s of this.editors.editors) this.push(s); }

  breakpointAt(state, path) {
    const line = this.mapFor(state.document).pathToLine.get(path);
    if (line == null) return { line: null, list: [] };
    return { line, list: this.sourceBreakpoints(state.document).filter((b) => b.location.range.start.line === line) };
  }

  /** F9 im Diagramm: Haltepunkt des Elements setzen oder entfernen */
  toggle(state, path) {
    if (!path || isRoot(path)) return;
    const { line, list } = this.breakpointAt(state, path);
    if (line == null) return;
    if (list.length) vscode.debug.removeBreakpoints(list);
    else vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(state.document.uri, new vscode.Position(line, 0)))]);
  }

  /** Bedingung, Trefferzahl, Logmeldung bearbeiten bzw. aktivieren/deaktivieren (Kontextmenü im Diagramm) */
  async edit(state, path, what) {
    const { line, list } = this.breakpointAt(state, path);
    if (line == null) return;
    const b = list[0];
    const opts = { enabled: b ? b.enabled : true, condition: b && b.condition, hitCondition: b && b.hitCondition, logMessage: b && b.logMessage };
    if (what === 'enable') opts.enabled = !opts.enabled;
    else {
      const field = { cond: 'condition', hit: 'hitCondition', log: 'logMessage' }[what];
      if (!field) return;
      const value = await vscode.window.showInputBox({
        title: t(`bp.${what}.title`),
        prompt: t(`bp.${what}.prompt`),
        placeHolder: t(`bp.${what}.placeholder`),
        value: opts[field] || '',
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      opts[field] = value.trim() || undefined;
      opts.enabled = true;
    }
    if (list.length) vscode.debug.removeBreakpoints(list);
    vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(state.document.uri, new vscode.Position(line, 0)),
      opts.enabled, opts.condition, opts.hitCondition, opts.logMessage)]);
  }

  /**
   * Nach einer Änderung am Struktogramm verschieben sich die Zeilen im XML. Haltepunkte bleiben beim Element mit
   * demselben Pfad (wie bisher im Diagramm) – VS Code verschiebt sie hier nicht von selbst.
   */
  onEdit(e) {
    const doc = e.document;
    if (!e.contentChanges.length || !/\.nsd$/i.test(doc.fileName)) return;
    const key = doc.uri.toString();
    const cached = this.maps.get(key);
    const old = cached && cached.version === doc.version ? this.prev.get(key) : cached;
    if (!old) return;
    const now = this.mapFor(doc);
    const moves = [];
    for (const b of this.sourceBreakpoints(doc)) {
      const line = b.location.range.start.line;
      const path = old.lineToPath.get(line);
      const to = path ? now.pathToLine.get(path) : null;
      if (to != null && to !== line) moves.push([b, to]);
    }
    if (!moves.length) return;
    vscode.debug.removeBreakpoints(moves.map(([b]) => b));
    vscode.debug.addBreakpoints(moves.map(([b, to]) => new vscode.SourceBreakpoint(new vscode.Location(doc.uri, new vscode.Position(to, 0)),
      b.enabled, b.condition, b.hitCondition, b.logMessage)));
  }

  /** Namen der Unterprogramme eines Dokuments (für Funktionshaltepunkte) */
  routineNames(document) {
    try { return fromNsd(document.getText()).roots.map((r) => P.parseSignature(r.text).name).filter(Boolean); } catch (e) { return []; }
  }
}

module.exports = { BreakpointSync };
