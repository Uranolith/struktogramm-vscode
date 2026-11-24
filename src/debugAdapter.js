'use strict';
/**
 * Echte Debug-Sitzung von VS Code für Struktogramme (Debug Adapter Protocol, im Erweiterungsprozess).
 *
 * Die Ausführung selbst bleibt im Struktogramm-Editor (ExecController/ExecSession, Anzeige, Eingabe).
 * Der Adapter verbindet sie mit dem Debug-Menü von VS Code:
 *  - Debug-Leiste und Tasten (Fortsetzen, Anhalten, Schritt über/hinein/heraus, Neustart, Beenden)
 *  - Aufrufliste mit Datei und Zeile des Elements; ein Klick markiert die Stelle im Diagramm
 *  - Variablen je Aufruf, Felder und Records aufklappbar, Werte änderbar
 *  - Überwachen und Debugkonsole (Auswertung im gewählten Aufruf, Vorschläge; bei INPUT: Eingabe)
 *  - Haltepunkte (über breakpoints.js), Funktionshaltepunkte, „Bei Laufzeitfehlern anhalten“
 *
 * Jede Ausführung eines gespeicherten Struktogramms bekommt eine Sitzung – auch wenn sie im Editor gestartet wurde
 * (dann wird die Sitzung nachträglich angehängt).
 */
const vscode = require('vscode');
const path = require('path');
const { t } = require('./i18n');
const { fmt, isRecord, typeLabel } = require('./core/executor');
const { fromNsd } = require('./core/nsdxml');

const TYPE = 'struktogramm';
const THREAD = 1;
const HANDLE_BASE = 100000; // variablesReference ab hier: aufklappbare Werte (Felder, Records)

/** Verbindet die Struktogramm-Editoren mit den Debug-Sitzungen */
class DebugBridge {
  /**
   * @param editors NsdEditorProvider (mit bpSync)
   * @param execCommand (cmd, uri, extra) => Promise – Ausführung in einem (ggf. erst zu öffnenden) Editor steuern
   */
  constructor(editors, execCommand) {
    this.editors = editors;
    this.execCommand = execCommand;
    this.adapters = new Map(); // Editor-Zustand -> Adapter
    this.bySession = new Map(); // Debug-Sitzung (id) -> Adapter
    this.expect = new Map();   // URI -> Adapter, der auf den Start der Ausführung wartet (Start aus VS Code)
    this.last = new WeakMap(); // Editor-Zustand -> letzte execState-Meldung
    this.buffer = new WeakMap(); // Editor-Zustand -> Meldungen, bis die nachträglich gestartete Sitzung da ist
    editors.execListeners.add((state, m) => this.onExec(state, m));
  }

  stateFor(uri) {
    const key = uri.toString();
    return [...this.editors.editors].find((s) => s.document.uri.toString() === key) || null;
  }

  onExec(state, m) {
    if (m.type === 'execReset') this.last.delete(state); // Zustand der vorherigen Ausführung gilt nicht mehr
    if (m.type === 'execState' && !m.refresh) this.last.set(state, m);
    const key = state.document.uri.toString();
    const waiting = this.expect.get(key);
    if (waiting && (m.type === 'execReset' || m.type === 'execOut')) { this.expect.delete(key); this.bind(state, waiting); }
    else if (m.type === 'execReset' && !this.adapters.has(state) && state.document.uri.scheme === 'file') this.autoStart(state);
    const a = this.adapters.get(state);
    if (a) a.onExec(m);
    else if (this.buffer.has(state)) { const b = this.buffer.get(state); if (b.length < 2000) b.push(m); }
  }

  bind(state, adapter) {
    const old = this.adapters.get(state);
    if (old && old !== adapter) old.end(0);
    this.adapters.set(state, adapter);
    const buffered = this.buffer.get(state) || [];
    this.buffer.delete(state);
    adapter.attach(state, buffered, this.last.get(state));
  }

  unbind(state, adapter) {
    if (state && this.adapters.get(state) === adapter) this.adapters.delete(state);
    for (const [k, a] of this.expect) if (a === adapter) this.expect.delete(k);
    for (const [k, a] of this.bySession) if (a === adapter) this.bySession.delete(k);
  }

  /** im Editor gestartete Ausführung: Debug-Sitzung nachträglich anhängen (ohne zur Debug-Ansicht zu wechseln) */
  autoStart(state) {
    const uri = state.document.uri;
    this.buffer.set(state, []);
    const config = { type: TYPE, request: 'launch', name: path.basename(uri.fsPath), program: uri.fsPath, __attach: uri.toString(), internalConsoleOptions: 'neverOpen' };
    Promise.resolve(vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(uri), config, { suppressDebugView: true }))
      .then((ok) => { if (!ok) this.buffer.delete(state); }, () => this.buffer.delete(state));
  }

  /** Befehl an die Ausführung im Editor (über die Webview: sie kennt das Tempo) */
  command(state, cmd, extra) {
    if (state && this.editors.editors.has(state)) state.panel.webview.postMessage({ type: 'execCommand', cmd, ...(extra || {}) });
  }

  /** In der Aufrufliste von VS Code gewählter Aufruf: Stelle im Diagramm markieren */
  focusFrame(item) {
    if (!item || !item.session || item.session.type !== TYPE || item.frameId == null) return;
    const a = this.bySession.get(item.session.id);
    if (a) a.focusFrame(item.frameId);
  }
}

/** Ein Debug-Adapter je Sitzung (DebugAdapterInlineImplementation) */
class StruktogrammDebugAdapter {
  constructor(bridge, session) {
    this.bridge = bridge;
    this.session = session;
    bridge.bySession.set(session.id, this);
    this.emitter = new vscode.EventEmitter();
    this.onDidSendMessage = this.emitter.event;
    this.seq = 1;
    this.state = null;      // Editor-Zustand
    this.frames = [];       // letzter Stand der Aufrufe (unten = Hauptprogramm)
    this.path = null;       // ausgeführtes Element
    this.running = false;
    this.ended = false;
    this.configured = false;
    this.held = [];         // Ereignisse bis configurationDone
    this.started = false;   // execReset gesehen
    this.inputHinted = false;
    this.title = '';
    this.breakOnError = true;
    this.handles = [];      // aufklappbare Werte (gelten bis zum nächsten Weiterlaufen)
    this.lastError = null;
  }

  /* ------------------------------ Senden ------------------------------ */
  emit(msg) { this.emitter.fire({ seq: this.seq++, ...msg }); }
  respond(req, body, error) {
    this.emit({ type: 'response', request_seq: req.seq, command: req.command, success: !error, message: error || undefined, body: body || {} });
  }
  event(event, body) {
    // Halt-Ereignisse erst nach configurationDone (vorher kennt VS Code die Haltepunkte noch nicht)
    if (!this.configured && event === 'stopped') { this.held.push([event, body]); return; }
    this.emit({ type: 'event', event, body: body || {} });
  }

  /* ------------------------------ Empfangen ------------------------------ */
  handleMessage(msg) {
    if (msg.type !== 'request') return;
    const fn = this['req_' + msg.command];
    if (!fn) { this.respond(msg, {}); return; }
    Promise.resolve().then(() => fn.call(this, msg, msg.arguments || {})).catch((e) => this.respond(msg, undefined, e && e.message ? e.message : String(e)));
  }

  req_initialize(req) {
    this.respond(req, {
      supportsConfigurationDoneRequest: true,
      supportsTerminateRequest: true,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: true,
      supportsFunctionBreakpoints: true,
      exceptionBreakpointFilters: [{ filter: 'errors', label: t('dap.exErrors'), description: t('dap.exErrorsDesc'), default: true }],
      supportsExceptionInfoRequest: true,
      supportsSetVariable: true,
      supportsCompletionsRequest: true,
      completionTriggerCharacters: [],
      supportsEvaluateForHovers: false,
      supportsStepBack: false,
      supportsRestartRequest: false,
    });
    this.emit({ type: 'event', event: 'initialized', body: {} });
  }

  async req_launch(req, args) {
    const uriStr = args.__attach || args.__uri;
    const uri = uriStr ? vscode.Uri.parse(uriStr) : vscode.Uri.file(String(args.program || ''));
    this.uri = uri;
    this.title = path.basename(uri.fsPath || uri.path);
    const st = this.bridge.stateFor(uri);
    // läuft dort schon etwas (im Editor gestartet oder vor dem Neustart), hängt sich die Sitzung an
    if (st && st.exec && st.exec.running) {
      this.bridge.bind(st, this);
      this.respond(req);
      return;
    }
    this.bridge.expect.set(uri.toString(), this);
    await this.bridge.execCommand(args.stopOnEntry ? 'step' : 'run', uri, { noDebug: !!args.noDebug });
    this.respond(req);
    // startet die Ausführung nicht (z.B. Datei nicht lesbar), nicht ewig warten
    setTimeout(() => { if (!this.state && !this.ended) { this.output(t('dap.noStart') + '\n', 'stderr'); this.end(1); } }, 20000);
  }

  req_configurationDone(req) {
    this.configured = true;
    this.respond(req);
    for (const [e, b] of this.held) this.emit({ type: 'event', event: e, body: b });
    this.held = [];
  }

  /** Haltepunkte setzt die Ansicht „Haltepunkte“ (breakpoints.js); hier nur: trifft die Zeile ein Element? */
  req_setBreakpoints(req, args) {
    const file = args.source && args.source.path;
    const doc = file && vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file || d.uri.toString() === file);
    const sync = this.bridge.editors.bpSync;
    const breakpoints = (args.breakpoints || []).map((b) => {
      const ok = !!(doc && sync && sync.pathAt(doc, b.line - 1));
      return ok ? { verified: true, line: b.line } : { verified: false, line: b.line, message: t('dap.bpNoElement') };
    });
    this.respond(req, { breakpoints });
  }

  /** Funktionshaltepunkt: Name eines Unterprogramms; hält beim Eintritt (ExecSession) */
  req_setFunctionBreakpoints(req, args) {
    const doc = this.document();
    const names = doc && this.bridge.editors.bpSync ? this.bridge.editors.bpSync.routineNames(doc).map((n) => n.toLowerCase()) : [];
    const breakpoints = (args.breakpoints || []).map((b) => (names.includes(String(b.name).trim().toLowerCase())
      ? { verified: true } : { verified: false, message: t('dap.fnNotFound', b.name) }));
    this.respond(req, { breakpoints });
  }

  req_setExceptionBreakpoints(req, args) {
    this.breakOnError = (args.filters || []).includes('errors');
    this.applyBreakOnError();
    this.respond(req, {});
  }

  req_exceptionInfo(req) {
    this.respond(req, { exceptionId: t('dap.exRuntime'), description: this.lastError || '', breakMode: 'always' });
  }

  req_threads(req) { this.respond(req, { threads: [{ id: THREAD, name: this.title || 'Struktogramm' }] }); }

  /** Aufrufliste: oben der laufende Aufruf; je Aufruf das Element (Text) mit Datei und Zeile in der .nsd */
  req_stackTrace(req) {
    const list = [...this.frames].reverse();
    const doc = this.document();
    const sync = this.bridge.editors.bpSync;
    const lines = doc && sync ? sync.mapFor(doc).pathToLine : new Map();
    const model = this.model();
    const stackFrames = list.map((f, i) => {
      const at = i === 0 ? this.path || f.at : f.at;
      const text = at ? this.elementText(model, at) : '';
      const line = at != null ? lines.get(at) : undefined;
      const frame = { id: i + 1, name: this.frameName(f) + (text ? ` · ${text}` : ''), line: 0, column: 0 };
      if (doc && line != null && doc.uri.scheme === 'file') {
        frame.source = { name: this.title, path: doc.uri.fsPath };
        frame.line = line + 1;
        frame.column = 1;
      }
      return frame;
    });
    this.respond(req, { stackFrames, totalFrames: stackFrames.length });
  }

  req_scopes(req, args) {
    this.respond(req, { scopes: [{ name: t('dap.vars'), variablesReference: args.frameId, expensive: false, presentationHint: 'locals' }] });
  }

  /** Variablen eines Aufrufs bzw. Inhalt eines Feldes/Records */
  req_variables(req, args) {
    const ref = args.variablesReference;
    let variables = [];
    if (ref >= HANDLE_BASE) {
      const v = this.handles[ref - HANDLE_BASE];
      if (Array.isArray(v)) variables = v.map((x, k) => this.variable(String(k), x));
      else if (isRecord(v)) variables = Object.keys(v).map((k) => this.variable(k, v[k]));
    } else {
      const raw = this.rawFrame(ref);
      if (raw) variables = [...raw.vars].map(([k, v]) => this.variable(k, v, raw.types.get(k)));
      else {
        const f = this.frameById(ref);
        variables = f ? f.vars.map((v) => ({ name: v.name, value: String(v.value), type: v.type || undefined, variablesReference: 0 })) : [];
      }
    }
    this.respond(req, { variables });
  }

  /** Wert in der Variablenansicht ändern: der neue Wert ist ein Ausdruck (ausgewertet im aktuellen Aufruf) */
  req_setVariable(req, args) {
    const sess = this.execSession();
    if (!sess || sess.state !== 'paused') throw new Error(t('dap.evalPaused'));
    const value = sess.evalNow(String(args.value));
    const ref = args.variablesReference;
    if (ref >= HANDLE_BASE) {
      const c = this.handles[ref - HANDLE_BASE];
      if (Array.isArray(c)) c[Number(args.name)] = value; else if (isRecord(c)) c[args.name] = value; else throw new Error(t('dap.cannotSet'));
    } else {
      const raw = this.rawFrame(ref);
      if (!raw || !raw.vars.has(args.name)) throw new Error(t('dap.cannotSet'));
      raw.vars.set(args.name, value);
    }
    const out = this.variable(args.name, value);
    this.respond(req, { value: out.value, type: out.type, variablesReference: out.variablesReference });
    // Anzeige im Struktograf-Panel nachziehen (ohne neues Halt-Ereignis)
    sess.post('paused', { refresh: true });
  }

  req_continue(req) { this.cmd('run'); this.respond(req, { allThreadsContinued: true }); }
  req_next(req) { this.cmd('over'); this.respond(req); }
  req_stepIn(req) { this.cmd('step'); this.respond(req); }
  req_stepOut(req) { this.cmd('out'); this.respond(req); }
  req_pause(req) { this.cmd('pause'); this.respond(req); }

  req_disconnect(req) { this.stopRun(); this.respond(req); this.end(0, true); }
  req_terminate(req) {
    const running = this.state && this.state.exec && this.state.exec.running;
    this.stopRun();
    this.respond(req);
    if (!running) this.end(0); // sonst beendet die Meldung „done“ der Ausführung die Sitzung
  }

  /** Überwachen / Debugkonsole: Variable oder Ausdruck im gewählten Aufruf; bei INPUT: Eingabe */
  req_evaluate(req, args) {
    const expr = String(args.expression || '').trim();
    const sess = this.execSession();
    if (args.context === 'repl' && sess && sess.state === 'input') {
      this.state.exec.handle({ type: 'execInput', value: expr });
      this.respond(req, { result: '', variablesReference: 0 });
      return;
    }
    const raw = this.rawFrame(args.frameId);
    if (raw && raw.vars.has(expr)) { const v = this.variable(expr, raw.vars.get(expr), raw.types.get(expr)); this.respond(req, { result: v.value, type: v.type, variablesReference: v.variablesReference }); return; }
    const f = this.frameById(args.frameId) || this.frames[this.frames.length - 1];
    const sv = f && f.vars.find((x) => x.name === expr);
    if (sv && (!sess || sess.state !== 'paused')) { this.respond(req, { result: String(sv.value), type: sv.type, variablesReference: 0 }); return; }
    if (!sess || sess.state !== 'paused') { this.respond(req, undefined, t('dap.evalPaused')); return; }
    // Ausdruck mit dem Interpreter im aktuellen Aufruf auswerten (Aufrufe von Unterprogrammen laufen mit)
    const v = this.variable('', sess.evalNow(expr));
    this.respond(req, { result: v.value, type: v.type, variablesReference: v.variablesReference });
  }

  /** Vorschläge in der Debugkonsole: Variablen des Aufrufs und Namen der Unterprogramme */
  req_completions(req, args) {
    const text = String(args.text || '');
    const col = Math.max(0, Math.min(text.length, (args.column || text.length + 1) - 1));
    const word = (/[\p{L}_][\p{L}\p{N}_]*$/u.exec(text.slice(0, col)) || [''])[0].toLowerCase();
    const raw = this.rawFrame(args.frameId) || this.rawFrame(1);
    const vars = raw ? [...raw.vars.keys()] : [];
    const doc = this.document();
    const subs = doc && this.bridge.editors.bpSync ? this.bridge.editors.bpSync.routineNames(doc) : [];
    const targets = [...new Set(vars)].map((n) => ({ label: n, type: 'variable' }))
      .concat([...new Set(subs)].map((n) => ({ label: n, type: 'function' })))
      .filter((c) => c.label.toLowerCase().startsWith(word))
      .map((c) => ({ ...c, start: col - word.length, length: word.length }));
    this.respond(req, { targets });
  }

  /* ------------------------------ Ausführung ------------------------------ */
  cmd(c) { this.bridge.command(this.state, c); }

  stopRun() {
    if (this.state && this.state.exec && this.state.exec.running) this.cmd('stop');
  }

  applyBreakOnError() {
    if (this.state && this.state.exec) this.state.exec.setDebug({ breakOnError: this.breakOnError && !this.ended });
  }

  attach(state, buffered, last) {
    this.state = state;
    this.applyBreakOnError();
    if (last && last.frames) this.frames = last.frames;
    for (const m of buffered) this.onExec(m);
    // im Editor gestartet: aktuellen Zustand nachreichen
    if (last && !buffered.includes(last)) this.onExec(last);
  }

  onExec(m) {
    if (this.ended) return;
    switch (m.type) {
      case 'execReset': this.started = true; this.running = false; break;
      case 'execOut':
        for (const l of m.lines || []) {
          this.output((l.kind === 'in' ? '› ' : '') + l.text + '\n', l.kind === 'err' ? 'stderr' : l.kind === 'info' ? 'console' : 'stdout');
          if (l.kind === 'err' && !this.started) this.end(1);
        }
        break;
      case 'execState':
        if (m.refresh) break; // nur Anzeige nachgezogen (Wert geändert)
        this.frames = m.frames || this.frames;
        this.path = m.path || null;
        if (m.state === 'paused') {
          this.running = false;
          this.inputHinted = false;
          this.handles = [];
          const body = { reason: m.reason || 'step', threadId: THREAD, allThreadsStopped: true };
          if (m.reason === 'exception') { this.lastError = m.description || ''; body.description = t('dap.exStopped'); body.text = m.description; }
          this.event('stopped', body);
        } else if (m.state === 'running' || m.state === 'input') {
          this.handles = [];
          if (!this.running) { this.running = true; this.event('continued', { threadId: THREAD, allThreadsContinued: true }); }
          if (m.state === 'input' && !this.inputHinted) { this.inputHinted = true; this.output(t('dap.inputHint') + '\n', 'console'); }
        } else if (m.state === 'done') {
          this.end(m.error ? 1 : 0);
        }
        break;
      default: break;
    }
  }

  output(text, category) { this.emit({ type: 'event', event: 'output', body: { category, output: text } }); }

  end(code, quiet) {
    if (this.ended) return;
    this.ended = true;
    // ohne Debug-Sitzung führen Laufzeitfehler wieder direkt zum Ende
    if (this.state && this.state.exec) this.state.exec.setDebug({ breakOnError: false });
    if (this.state && this.bridge.editors.editors.has(this.state)) this.state.panel.webview.postMessage({ type: 'execFocus', path: null });
    this.bridge.unbind(this.state, this);
    if (!quiet) this.emit({ type: 'event', event: 'exited', body: { exitCode: code } });
    this.emit({ type: 'event', event: 'terminated', body: {} });
  }

  /** gewählter Aufruf in der Aufrufliste: Stelle im Diagramm markieren */
  focusFrame(frameId) {
    const f = this.frameById(frameId);
    if (!f || !this.state || !this.bridge.editors.editors.has(this.state)) return;
    const at = frameId === 1 ? null : f.at; // oberster Aufruf ist ohnehin markiert
    this.state.panel.webview.postMessage({ type: 'execFocus', path: at });
  }

  /* ------------------------------ Hilfen ------------------------------ */
  execSession() { return this.state && this.state.exec && this.state.exec.session; }

  document() {
    if (this.state) return this.state.document;
    return this.uri ? vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.uri.toString()) : null;
  }

  model() { try { const d = this.document(); return d ? fromNsd(d.getText()) : null; } catch (e) { return null; } }

  frameById(id) {
    const list = [...this.frames].reverse();
    return Number.isInteger(id) && id >= 1 ? list[id - 1] || null : null;
  }

  /** Aufruf im Interpreter (echte Werte) zur Nummer in der Aufrufliste – nur solange angehalten/wartend */
  rawFrame(id) {
    const sess = this.execSession();
    if (!sess || !Number.isInteger(id) || id < 1 || id >= HANDLE_BASE || sess.state === 'done') return null;
    const frames = sess.interp.frames;
    return frames[frames.length - id] || null;
  }

  /** Variable für die Ansicht; Felder und Records bekommen einen Verweis zum Aufklappen */
  variable(name, v, type) {
    const container = Array.isArray(v) || isRecord(v);
    const ref = container ? HANDLE_BASE + this.handles.push(v) - 1 : 0;
    const out = { name, value: fmt(v, true), type: type || typeLabel(v) || undefined, variablesReference: ref };
    if (Array.isArray(v)) out.indexedVariables = v.length;
    return out;
  }

  frameName(f) { return f.main || !f.callNo ? f.name : `${f.name} #${f.callNo}`; }

  /** Text eines Elements (für die Aufrufliste) */
  elementText(model, p) {
    if (!model || !p) return '';
    let node = model;
    for (const part of p.split('/')) { if (node == null) return ''; node = node[/^\d+$/.test(part) ? Number(part) : part]; }
    const text = node && Array.isArray(node.text) ? node.text.map(String).filter((l) => l.trim()).join(' · ') : '';
    return text.length > 60 ? text.slice(0, 57) + '…' : text;
  }

  dispose() { this.bridge.unbind(this.state, this); this.emitter.dispose(); }
}

function registerDebugAdapter(context, editors, execCommand) {
  const bridge = new DebugBridge(editors, execCommand);
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(TYPE, {
    createDebugAdapterDescriptor: (session) => new vscode.DebugAdapterInlineImplementation(new StruktogrammDebugAdapter(bridge, session)),
  }));
  // Klick in der Aufrufliste (ab VS Code 1.90) → Stelle im Diagramm
  if (vscode.debug.onDidChangeActiveStackItem) {
    context.subscriptions.push(vscode.debug.onDidChangeActiveStackItem((item) => bridge.focusFrame(item)));
  }
  return bridge;
}

module.exports = { registerDebugAdapter, DebugBridge, StruktogrammDebugAdapter };
