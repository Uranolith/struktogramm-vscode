'use strict';
const vscode = require('vscode');
const path = require('path');
const { parseCode, supportedLanguage } = require('./core/parsers');
const { generateCode, TARGETS, toClassName } = require('./core/generators');
const { fromNsd, toNsd, rootToNsd } = require('./core/nsdxml');
const { collectSymbols } = require('./core/symbols');
const X = require('./core/exporters');
const { apply } = require('./core/edit');
const { mk } = require('./core/model');
const { webviewHtml, settings, render, diagramTheme } = require('./webview');
const { parseSignature } = require('./core/pseudo');
const { ExecController } = require('./execSession');
const S = require('./structorizer');
const { t, setLanguage } = require('./i18n');
const { ToolsViewProvider, VIEW_ID } = require('./toolsView');
const { toolbarLocation } = require('./webview');

let extContext = null;

/** Dateiendungen, die nur der Structorizer-Parser kann */
const STRUCTORIZER_ONLY = /\.(pas|dpr|pp|lpr|cob|cbl|cobol|cpy|pde)$/i;
const STRUCTORIZER_CAN = /\.(pas|dpr|pp|lpr|cob|cbl|cobol|cpy|pde|c|java)$/i;

/* ====================================================================== */
/* Custom Editor für .nsd                                                  */
/* ====================================================================== */
class NsdEditorProvider {
  constructor(context) {
    this.context = context;
    this.active = null;      // { document, panel }
    this.editors = new Set();
    this.clipboard = null;   // kopiertes Element (zwischen allen Editoren)
    this.pending = new Map(); // uri -> 'run'|'step': nach dem Öffnen automatisch starten
    this.tools = null;       // Struktograf-Seitenleiste mit den Werkzeugen
  }

  /** aktiven Editor setzen und die Seitenleiste nachziehen */
  setActive(state) {
    if (this.active === state) return;
    this.active = state;
    if (this.tools) this.tools.refresh(true);
  }

  resolveCustomTextEditor(document, panel) {
    const state = { document, panel, select: undefined, editNew: false };
    this.editors.add(state);
    this.setActive(state);
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri, false);
    state.exec = new ExecController(panel.webview, () => fromNsd(document.getText()),
      () => (document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined));

    const send = () => {
      let model = null, error = null, svg = '';
      try {
        model = fromNsd(document.getText());
        svg = render(model).svg;
      } catch (e) {
        error = t('ext.cannotRead', e.message);
      }
      panel.webview.postMessage({ type: 'update', doc: model, svg, error, symbols: collectSymbols(model), select: state.select, editNew: state.editNew, settings: settings(), hasClipboard: !!this.clipboard });
      state.select = undefined;
      state.editNew = false;
    };
    state.send = send;

    const subs = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) {
          state.exec.abort(t('ext.abortDiagramChanged'));
          send();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('struktogramm')) send(); }),
      vscode.window.onDidChangeActiveColorTheme(() => send()),
      panel.onDidChangeViewState(() => { if (panel.active) this.setActive(state); }),
    ];
    panel.onDidDispose(() => {
      state.exec.abort();
      subs.forEach((s) => s.dispose());
      this.editors.delete(state);
      if (this.active === state) this.setActive(null);
    });

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (state.exec.handle(msg) || handlePngData(msg)) return;
        switch (msg.type) {
          case 'toolState': if (this.tools) this.tools.setState(state, msg.state); break;
          case 'ready': {
            send();
            const key = document.uri.toString();
            const pend = this.pending.get(key);
            if (pend) { this.pending.delete(key); panel.webview.postMessage({ type: 'execCommand', cmd: pend }); }
            break;
          }
          case 'op': {
            let cmd = msg.cmd;
            if (cmd.op === 'pasteClipboard') {
              if (!this.clipboard) { vscode.window.showInformationMessage(t('ext.clipboardEmpty')); return; }
              cmd = { op: 'paste', path: cmd.path, where: cmd.where, element: this.clipboard };
            }
            await this.applyOp(state, cmd);
            break;
          }
          case 'previewInsert': {
            // Vorschau für das Einfügen per Tastatur: Diagramm mit dem neuen Element zeichnen, ohne die Datei zu ändern
            let model;
            try { model = fromNsd(document.getText()); } catch (e) { break; }
            let path = null, svg = '';
            try {
              path = apply(model, { op: 'insert', path: msg.path, kind: msg.kind, where: msg.where });
              svg = render(model).svg;
            } catch (e) { break; }
            panel.webview.postMessage({ type: 'preview', token: msg.token, svg, path });
            break;
          }
          case 'copy': this.clipboard = msg.element; this.editors.forEach((s) => s.panel.webview.postMessage({ type: 'clipboard', has: true })); break;
          case 'toCode': await toCode(document.uri, this); break;
          case 'newFile': await newFile(document.uri); break;
          case 'exportSvg': await exportSvg(document); break;
          case 'exportPng': await exportPng(document.uri, fromNsd(document.getText()), panel.webview); break;
          case 'exportSingle': await exportSingle(document); break;
          case 'exportMenu': await exportAs(msg.format, document.uri, fromNsd(document.getText()), panel.webview, document); break;
          case 'openStructorizer': await openInStructorizer(document); break;
          case 'undo': await vscode.commands.executeCommand('undo'); break;
          case 'redo': await vscode.commands.executeCommand('redo'); break;
          case 'openText': await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', vscode.ViewColumn.Beside); break;
          default: break;
        }
      } catch (e) {
        vscode.window.showErrorMessage(t('ext.errorPrefix', e.message));
        send();
      }
    });
  }

  async applyOp(state, cmd) {
    const { document } = state;
    let model;
    try { model = fromNsd(document.getText()); } catch (e) { model = { roots: [] }; }
    const sel = apply(model, cmd);
    state.select = sel;
    // Einfügen per Tastatur-Auswahl (noEdit): erst mit einem weiteren Enter bearbeiten
    state.editNew = (cmd.op === 'insert' && !cmd.noEdit) || cmd.op === 'addRoot' || cmd.op === 'changeType';
    const text = toNsd(model);
    if (text === document.getText()) { state.send(); return; }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
  }
}

/* ====================================================================== */
/* Live-Vorschau für Quelltext                                             */
/* ====================================================================== */
class PreviewPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.docUri = null;
    this.timer = null;
  }

  show(editor) {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('struktogramm.preview', t('ext.previewTitle'), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      });
      this.panel.webview.html = webviewHtml(this.panel.webview, this.context.extensionUri, true);
      this.exec = new ExecController(this.panel.webview, () => { const d = this.document(); if (!d) throw new Error(t('ext.noSource')); return this.model(d); },
        () => { const d = this.document(); return d && d.uri.scheme === 'file' ? path.dirname(d.uri.fsPath) : undefined; });
      const subs = [
        vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed && supportedLanguage(ed.document.languageId, ed.document.fileName)) { this.docUri = ed.document.uri; this.exec.abort(); this.update(); } }),
        vscode.workspace.onDidChangeTextDocument((e) => { if (this.docUri && e.document.uri.toString() === this.docUri.toString()) { this.exec.abort(t('ext.abortCodeChanged')); this.schedule(); } }),
        vscode.window.onDidChangeTextEditorSelection((e) => { if (this.docUri && e.textEditor.document.uri.toString() === this.docUri.toString() && !this.exec.running) this.schedule(); }),
        vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('struktogramm')) this.update(); }),
        vscode.window.onDidChangeActiveColorTheme(() => this.update()),
      ];
      this.panel.onDidDispose(() => { this.exec.abort(); subs.forEach((s) => s.dispose()); this.panel = null; });
      this.panel.webview.onDidReceiveMessage(async (msg) => {
        try {
          if (this.exec.handle(msg) || handlePngData(msg)) return;
          const doc = this.document();
          if (!doc) return;
          if (msg.type === 'ready') this.update();
          else if (msg.type === 'saveNsd') await fromCode(doc.uri);
          else if (msg.type === 'toCode') await toCodeFromModel(this.model(doc), path.basename(doc.fileName).replace(/\.[^.]*$/, ''));
          else if (msg.type === 'exportPng') await exportPng(doc.uri, this.model(doc), this.panel.webview);
          else if (msg.type === 'exportSvg') await saveSvg(doc.uri, this.model(doc));
          else if (msg.type === 'exportMenu') await exportAs(msg.format, doc.uri, this.model(doc), this.panel.webview, null);
        } catch (e) { vscode.window.showErrorMessage(t('ext.errorPrefix', e.message)); }
      });
    } else this.panel.reveal(vscode.ViewColumn.Beside, true);
    this.docUri = editor.document.uri;
    this.update();
  }

  document() {
    if (!this.docUri) return null;
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.docUri.toString()) || null;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 350);
  }

  model(doc) {
    const lang = supportedLanguage(doc.languageId, doc.fileName);
    const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    const sel = ed && !ed.selection.isEmpty ? doc.getText(ed.selection) : null;
    const name = doc.isUntitled ? t('core.mainProgram') : path.basename(doc.fileName).replace(/\.[^.]*$/, '');
    return parseCode(sel || doc.getText(), lang, { name });
  }

  update() {
    if (!this.panel) return;
    const doc = this.document();
    if (!doc) return;
    this.panel.title = t('ext.previewTitleFile', path.basename(doc.fileName));
    let model = null, svg = '', error = null;
    try {
      model = this.model(doc);
      svg = render(model).svg;
    } catch (e) {
      error = 'Der Code konnte nicht umgewandelt werden: ' + e.message;
    }
    this.panel.webview.postMessage({ type: 'update', doc: model, svg, error, settings: settings() });
  }
}

/* ====================================================================== */
/* Befehle                                                                  */
/* ====================================================================== */
async function exists(uri) {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

async function writeText(uri, text) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

/**
 * Code -> Struktogramm (.nsd-Datei neben der Quelldatei)
 * @param {'auto'|'own'|'structorizer'} engine
 */
async function fromCode(arg, engine = 'auto') {
  let doc, editor;
  if (arg instanceof vscode.Uri) {
    editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === arg.toString());
    doc = editor ? editor.document : await vscode.workspace.openTextDocument(arg);
  } else {
    editor = vscode.window.activeTextEditor;
    doc = editor && editor.document;
  }
  if (!doc) { vscode.window.showWarningMessage(t('ext.openSourceFirst')); return; }
  const ownLang = supportedLanguage(doc.languageId, doc.fileName);
  if (engine === 'auto') {
    const pref = vscode.workspace.getConfiguration('struktogramm').get('importEngine', 'eigene');
    if (!ownLang || STRUCTORIZER_ONLY.test(doc.fileName)) engine = 'structorizer';
    else engine = pref === 'structorizer' && STRUCTORIZER_CAN.test(doc.fileName) ? 'structorizer' : 'own';
  }
  if (engine === 'own' && !ownLang) { vscode.window.showWarningMessage(t('ext.langUnsupported', doc.languageId)); return; }
  if (engine === 'structorizer' && !STRUCTORIZER_CAN.test(doc.fileName)) {
    vscode.window.showWarningMessage(t('ext.structorizerParserLangs'));
    return;
  }
  const useSel = editor && !editor.selection.isEmpty && editor.document === doc;
  const src = useSel ? doc.getText(editor.selection) : doc.getText();
  const base = doc.isUntitled ? t('ext.untitledName') : path.basename(doc.fileName).replace(/\.[^.]*$/, '');
  let model;
  if (engine === 'structorizer') {
    try { model = await S.importCode(extContext, src, doc.fileName); } catch (e) { vscode.window.showErrorMessage(e.message); return; }
    if (!model) return;
  } else model = parseCode(src, ownLang, { name: base });
  if (!model.roots.length) { vscode.window.showWarningMessage(t('ext.nothingFound')); return; }

  let target;
  if (doc.isUntitled) {
    target = await vscode.window.showSaveDialog({ filters: { [t('ext.filterNsd')]: ['nsd'] }, saveLabel: t('ext.saveNsd') });
    if (!target) return;
  } else {
    target = vscode.Uri.file(path.join(path.dirname(doc.fileName), base + (useSel ? t('ext.selectionSuffix') : '') + '.nsd'));
    if (await exists(target)) {
      const choice = await vscode.window.showWarningMessage(t('ext.exists', path.basename(target.fsPath)), { modal: true }, t('ext.overwrite'), t('ext.otherName'));
      if (!choice) return;
      if (choice !== t('ext.overwrite')) {
        target = await vscode.window.showSaveDialog({ defaultUri: target, filters: { [t('ext.filterNsd')]: ['nsd'] } });
        if (!target) return;
      }
    }
  }
  await writeText(target, toNsd(model));
  await vscode.commands.executeCommand('vscode.openWith', target, 'struktogramm.editor', vscode.ViewColumn.Beside);
}

/** Zielsprache wählen: eigene Übersetzung oder Original-Structorizer-Generator */
async function pickLanguage(context) {
  const def = vscode.workspace.getConfiguration('struktogramm').get('defaultTargetLanguage');
  if (def && TARGETS[def]) return { engine: 'own', id: def };
  if (def && def.startsWith('structorizer:')) {
    const g = S.GENERATORS.find((x) => x.id.toLowerCase() === def.slice(13).toLowerCase());
    if (g) return { engine: 'structorizer', id: g.id, languageId: g.languageId };
  }
  const last = context.globalState.get('lastTarget2', 'own:python');
  const haveJar = !!S.findJar(context);
  const items = [{ label: t('ext.pickOwn'), kind: vscode.QuickPickItemKind.Separator }];
  for (const [id, tg] of Object.entries(TARGETS)) items.push({ label: tg.label, key: 'own:' + id, engine: 'own', id });
  items.push({ label: t('ext.pickStructorizer') + (haveJar ? '' : t('ext.pickDownloadHint')), kind: vscode.QuickPickItemKind.Separator });
  for (const g of S.GENERATORS) items.push({ label: g.label, description: 'Structorizer', key: 'structorizer:' + g.id, engine: 'structorizer', id: g.id, languageId: g.languageId });
  const lastItem = items.find((i) => i.key === last);
  if (lastItem) lastItem.description = (lastItem.description ? lastItem.description + ' · ' : '') + t('ext.lastUsed');
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t('ext.pickLanguage'), matchOnDescription: true });
  if (!pick) return null;
  await context.globalState.update('lastTarget2', pick.key);
  return pick;
}

/* ====================================================================== */
/* Live-Code: erzeugter, noch ungespeicherter Code folgt dem Struktogramm  */
/* ====================================================================== */
const liveLinks = new Map(); // URI des erzeugten Dokuments -> { codeDoc, srcUri, target, baseName, text, timer }
let liveStatus = null;

function updateLiveStatus() {
  if (!liveStatus) return;
  const ed = vscode.window.activeTextEditor;
  const link = ed && liveLinks.get(ed.document.uri.toString());
  if (!link) { liveStatus.hide(); return; }
  liveStatus.text = `$(sync) Live: ${path.basename(vscode.Uri.parse(link.srcUri).fsPath)}`;
  liveStatus.tooltip = t('ext.liveTooltip');
  liveStatus.show();
}

function endLive(key, reason) {
  const link = liveLinks.get(key);
  if (!link) return;
  clearTimeout(link.timer);
  liveLinks.delete(key);
  updateLiveStatus();
  if (reason) vscode.window.setStatusBarMessage(t('ext.liveEnded', reason), 6000);
}

function registerLiveCode(codeDoc, srcUri, target, baseName) {
  liveLinks.set(codeDoc.uri.toString(), { codeDoc, srcUri: srcUri.toString(), target, baseName, text: codeDoc.getText(), timer: null });
  updateLiveStatus();
}

/** Struktogramm wurde geändert -> verknüpfte Code-Dokumente (verzögert) neu erzeugen */
function scheduleLiveUpdate(nsdDoc) {
  const src = nsdDoc.uri.toString();
  for (const [key, link] of liveLinks) {
    if (link.srcUri !== src) continue;
    clearTimeout(link.timer);
    link.timer = setTimeout(() => { updateLiveCode(key, link, nsdDoc).catch(() => {}); }, 250);
  }
}

async function updateLiveCode(key, link, nsdDoc) {
  const d = link.codeDoc;
  if (d.isClosed || !d.isUntitled) { endLive(key); return; }
  if (link.text === null) { scheduleLiveUpdate(nsdDoc); return; } // vorheriges Schreiben läuft noch
  if (d.getText() !== link.text) { endLive(key, t('ext.reasonEdited')); return; }
  let code;
  try {
    const model = fromNsd(nsdDoc.getText());
    if (!model.roots.length) return;
    code = generateCode(model, link.target, { className: toClassName(link.baseName) });
  } catch (e) { return; } // unvollständiges Diagramm: alten Stand behalten
  if (code.replace(/\r\n/g, '\n') === d.getText().replace(/\r\n/g, '\n')) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(d.uri, new vscode.Range(0, 0, d.lineCount, 0), code);
  link.text = null; // während des Schreibens keine Handänderung erkennen
  await vscode.workspace.applyEdit(edit);
  link.text = d.getText();
}

async function toCodeFromModel(model, baseName, srcUri) {
  const pick = await pickLanguage(extContext);
  if (!pick) return;
  let code, languageId;
  if (pick.engine === 'structorizer') {
    try { code = await S.exportCode(extContext, model, pick.id); } catch (e) { vscode.window.showErrorMessage(e.message); return; }
    if (code == null) return;
    languageId = pick.languageId;
  } else {
    code = generateCode(model, pick.id, { className: toClassName(baseName) });
    languageId = TARGETS[pick.id].languageId;
  }
  let doc;
  try { doc = await vscode.workspace.openTextDocument({ language: languageId, content: code }); }
  catch { doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: code }); }
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  // Eigene Übersetzung aus einer .nsd: Code bleibt bis zum Speichern mit dem Struktogramm verbunden
  if (srcUri && pick.engine === 'own') registerLiveCode(doc, srcUri, pick.id, baseName);
  if (pick.id === 'java' || pick.id === 'Java') vscode.window.setStatusBarMessage(t('ext.javaTip', toClassName(baseName)), 8000);
}

async function nsdUri(arg, provider) {
  let uri = arg instanceof vscode.Uri ? arg : null;
  if (!uri && provider.active) uri = provider.active.document.uri;
  if (!uri) {
    const ed = vscode.window.activeTextEditor;
    if (ed && /\.nsd$/i.test(ed.document.fileName)) uri = ed.document.uri;
  }
  if (!uri) vscode.window.showWarningMessage(t('ext.openNsdFirst'));
  return uri;
}

/** Struktogramm -> Code */
async function toCode(arg, provider) {
  const uri = await nsdUri(arg, provider);
  if (!uri) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  const model = fromNsd(doc.getText());
  if (!model.roots.length) { vscode.window.showWarningMessage(t('ext.emptyDiagram')); return; }
  await toCodeFromModel(model, path.basename(uri.fsPath).replace(/\.[^.]*$/, ''), uri);
}

async function openInStructorizer(document) {
  if (document.isDirty) await document.save();
  await S.openInStructorizer(extContext, fromNsd(document.getText()), document.uri.fsPath);
}

/* ---------------------------- Export-Menü ---------------------------- */
const EXPORTS = ['svg', 'png', 'json', 'xml', 'aiClip', 'aiFile', 'single'];
const exportItems = () => EXPORTS.map((id) => ({ id, label: t(`ext.export.${id}`), description: t(`ext.export.${id}.desc`), nsdOnly: id === 'single' }));

async function saveTextExport(srcUri, ext, filterName, content) {
  const def = vscode.Uri.file(srcUri.fsPath.replace(/\.[^.\\/]*$/, '') + ext);
  const target = await vscode.window.showSaveDialog({ defaultUri: def, filters: { [filterName]: [ext.replace(/^.*\./, '')] } });
  if (!target) return;
  await writeText(target, content);
  vscode.window.showInformationMessage(t('ext.saved', path.basename(target.fsPath)));
}

/** Exportformat wählen bzw. direkt ausführen. nsdDocument nur im .nsd-Editor (für Einzeldateien). */
async function exportAs(format, srcUri, model, webview, nsdDocument) {
  if (!format) {
    // PNG braucht das Webview (Canvas) – ohne geöffneten Editor nicht verfügbar
    const items = exportItems().filter((e) => (!e.nsdOnly || nsdDocument) && (e.id !== 'png' || webview));
    const pick = await vscode.window.showQuickPick(items, { title: t('ext.exportTitle'), placeHolder: t('ext.chooseFormat') });
    if (!pick) return;
    format = pick.id;
  }
  switch (format) {
    case 'svg': return saveSvg(srcUri, model);
    case 'png': return exportPng(srcUri, model, webview);
    case 'json': return saveTextExport(srcUri, '.json', 'JSON', X.toJson(model));
    case 'xml': return saveTextExport(srcUri, '.xml', 'XML', X.toXml(model));
    case 'aiFile': return saveTextExport(srcUri, t('ext.aiFileSuffix'), 'Text', X.toCompact(model));
    case 'aiClip': {
      const text = X.toCompact(model);
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage(t('ext.aiCopied', text.length, Math.ceil(text.length / 3.6)));
      return undefined;
    }
    case 'single': return nsdDocument ? exportSingle(nsdDocument) : undefined;
    default: return undefined;
  }
}

/** Farbschema für den Bild-Export wählen (Einstellung struktogramm.exportTheme) */
async function pickExportTheme(kind) {
  const pref = vscode.workspace.getConfiguration('struktogramm').get('exportTheme', 'ask');
  const current = diagramTheme();
  if (pref === 'light' || pref === 'dark') return pref;
  if (pref === 'editor') return current;
  const last = extContext.globalState.get('lastExportTheme');
  const items = [
    { label: t('ext.themeLight'), description: t('ext.themeLight.desc'), theme: 'light' },
    { label: t('ext.themeDark'), description: t('ext.themeDark.desc'), theme: 'dark' },
  ];
  items.forEach((it) => { if (it.theme === current) it.detail = t('ext.themeCurrent'); });
  if (last) items.sort((a, b) => (b.theme === last) - (a.theme === last));
  const pick = await vscode.window.showQuickPick(items, { title: t('ext.themeTitle', kind), placeHolder: t('ext.themePlaceholder') });
  if (!pick) return null;
  await extContext.globalState.update('lastExportTheme', pick.theme);
  return pick.theme;
}

async function saveSvg(srcUri, model) {
  const theme = await pickExportTheme('SVG');
  if (!theme) return;
  const def = vscode.Uri.file(srcUri.fsPath.replace(/\.[^.\\/]*$/, '') + (theme === 'dark' ? t('ext.darkSuffix') : '') + '.svg');
  const target = await vscode.window.showSaveDialog({ defaultUri: def, filters: { [t('ext.svgImage')]: ['svg'] } });
  if (!target) return;
  await writeText(target, '<?xml version="1.0" encoding="UTF-8"?>\n' + render(model, { theme }).svg);
  vscode.window.showInformationMessage(t('ext.saved', path.basename(target.fsPath)));
}

async function exportSvg(document) {
  await saveSvg(document.uri, fromNsd(document.getText()));
}

/* PNG: das Webview rechnet das SVG in ein Bild um (Canvas) */
const pngWaiters = new Map();
let pngSeq = 0;
function requestPng(webview, svg) {
  const id = ++pngSeq;
  return new Promise((resolve, reject) => {
    pngWaiters.set(id, { resolve, reject });
    webview.postMessage({ type: 'renderPng', id, svg });
    setTimeout(() => { if (pngWaiters.delete(id)) reject(new Error('PNG-Erzeugung hat zu lange gedauert.')); }, 20000);
  });
}
function handlePngData(msg) {
  if (!msg || msg.type !== 'pngData') return false;
  const w = pngWaiters.get(msg.id);
  if (w) {
    pngWaiters.delete(msg.id);
    if (msg.dataUrl) w.resolve(msg.dataUrl); else w.reject(new Error(msg.error || 'PNG-Export fehlgeschlagen.'));
  }
  return true;
}

async function exportPng(srcUri, model, webview) {
  const theme = await pickExportTheme('PNG');
  if (!theme) return;
  const dataUrl = await requestPng(webview, render(model, { theme }).svg);
  await savePng(srcUri, dataUrl, theme);
}

async function savePng(srcUri, dataUrl, theme) {
  const def = vscode.Uri.file(srcUri.fsPath.replace(/\.[^.\\/]*$/, '') + (theme === 'dark' ? t('ext.darkSuffix') : '') + '.png');
  const target = await vscode.window.showSaveDialog({ defaultUri: def, filters: { [t('ext.pngImage')]: ['png'] } });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  vscode.window.showInformationMessage(t('ext.saved', path.basename(target.fsPath)));
}

async function exportSingle(document) {
  // für den Original-Structorizer: Zuweisungen mit <-
  const model = require('./core/style').toStructorizer(fromNsd(document.getText()));
  const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: t('ext.chooseFolder'), defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)) });
  if (!folder || !folder[0]) return;
  const used = new Set();
  for (const r of model.roots) {
    let name = parseSignature(r.text).name;
    while (used.has(name)) name += '_';
    used.add(name);
    await writeText(vscode.Uri.joinPath(folder[0], name + '.nsd'), rootToNsd(r));
  }
  vscode.window.showInformationMessage(t('ext.diagramsSaved', model.roots.length));
}

/**
 * Neues Struktogramm anlegen.
 * Ordner: angeklickter Ordner im Explorer (bzw. Ordner der angeklickten Datei), sonst Ordner der aktiven Datei,
 * sonst erster Arbeitsbereichsordner. Ohne geöffneten Ordner: Speichern-Dialog.
 */
async function newFile(uri) {
  const exists = async (u) => { try { await vscode.workspace.fs.stat(u); return true; } catch { return false; } };
  // Zielordner bestimmen
  let folder = null;
  if (uri instanceof vscode.Uri && uri.scheme === 'file') {
    try {
      const st = await vscode.workspace.fs.stat(uri);
      folder = st.type & vscode.FileType.Directory ? uri : vscode.Uri.joinPath(uri, '..');
    } catch { folder = null; }
  }
  if (!folder) {
    const active = (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri) ||
      (vscode.window.tabGroups.activeTabGroup.activeTab && vscode.window.tabGroups.activeTabGroup.activeTab.input && vscode.window.tabGroups.activeTabGroup.activeTab.input.uri);
    if (active && active.scheme === 'file' && vscode.workspace.getWorkspaceFolder(active)) folder = vscode.Uri.joinPath(active, '..');
  }
  const ws = vscode.workspace.workspaceFolders;
  if (!folder && ws && ws.length) folder = ws[0].uri;

  let target;
  if (folder) {
    // freien Vorschlag finden: Struktogramm.nsd, Struktogramm2.nsd …
    const baseName = t('ext.newBase');
    let suggestion = `${baseName}.nsd`;
    for (let k = 2; await exists(vscode.Uri.joinPath(folder, suggestion)) && k < 1000; k++) suggestion = `${baseName}${k}.nsd`;
    const rel = vscode.workspace.asRelativePath(folder, true);
    const name = await vscode.window.showInputBox({
      title: t('ext.newTitle'),
      prompt: t('ext.newPrompt', rel),
      value: suggestion,
      valueSelection: [0, suggestion.length - 4],
      validateInput: async (v) => {
        const n = v.trim();
        if (!n || /^\.nsd$/i.test(n)) return t('ext.enterName');
        if (/[\\/:*?"<>|]/.test(n)) return t('ext.invalidChars');
        const file = /\.nsd$/i.test(n) ? n : n + '.nsd';
        return (await exists(vscode.Uri.joinPath(folder, file))) ? t('ext.existsInFolder', file) : null;
      },
    });
    if (!name) return;
    const file = /\.nsd$/i.test(name.trim()) ? name.trim() : name.trim() + '.nsd';
    target = vscode.Uri.joinPath(folder, file);
  } else {
    target = await vscode.window.showSaveDialog({ filters: { [t('ext.filterNsd')]: ['nsd'] }, saveLabel: t('ext.create'), title: t('ext.newTitle') });
    if (!target) return;
  }
  const title = path.basename(target.fsPath).replace(/\.[^.]*$/, '');
  await writeText(target, toNsd({ roots: [mk.root(title, 'program', [])] }));
  await vscode.commands.executeCommand('vscode.openWith', target, 'struktogramm.editor');
}

async function setupStructorizer(context) {
  const jar = S.findJar(context);
  if (jar) {
    const c = await vscode.window.showInformationMessage(t('ext.structorizerSetUp', jar), t('ext.downloadLatest'), t('ext.otherLocation'));
    if (c === t('ext.downloadLatest')) {
      try { const j = await S.download(context); vscode.window.showInformationMessage(t('ext.structorizerUpdated', j)); } catch (e) { vscode.window.showErrorMessage(t('ext.downloadFailed', e.message)); }
    } else if (c === t('ext.otherLocation')) {
      await vscode.workspace.getConfiguration('struktogramm.structorizer').update('jarPath', '', vscode.ConfigurationTarget.Global);
      await S.ensure(context, true);
    }
    return;
  }
  const j = await S.ensure(context, true);
  if (j) vscode.window.showInformationMessage(t('ext.structorizerReady', j));
}

function activate(context) {
  extContext = context;
  setLanguage(vscode.env.language); // Englisch, bei deutscher VS-Code-Oberfläche Deutsch
  const provider = new NsdEditorProvider(context);
  const preview = new PreviewPanel(context);
  // Werkzeuge in der Editor-Kopfzeile oder in der Struktograf-Seitenleiste (Einstellung struktogramm.toolbarLocation)
  const tools = new ToolsViewProvider(context, provider);
  provider.tools = tools;
  const applyToolbarLocation = (reveal) => {
    const loc = toolbarLocation();
    vscode.commands.executeCommand('setContext', 'struktograf.toolsInSidebar', loc === 'sidebar');
    provider.editors.forEach((s) => s.panel.webview.postMessage({ type: 'toolbarMode', mode: loc }));
    if (reveal && loc === 'sidebar') vscode.commands.executeCommand('workbench.view.extension.struktograf');
  };
  applyToolbarLocation(false);
  const activeEditorDoc = () => (provider.active ? provider.active.document : null);
  /**
   * Ausführung steuern (F5 / F10 / F6 / Shift+F5). Ziel: aktive Live-Vorschau, sonst der aktive .nsd-Editor.
   * Mit uri (Explorer, Titelleiste): Datei im Struktogramm-Editor öffnen und danach starten.
   */
  async function execCommand(cmd, uri) {
    const msg = { type: 'execCommand', cmd };
    if (uri && uri.fsPath && /\.nsd$/i.test(uri.fsPath)) {
      const open = [...provider.editors].find((s) => s.document.uri.toString() === uri.toString());
      if (open) { open.panel.reveal(); open.panel.webview.postMessage(msg); return; }
      if (cmd === 'run' || cmd === 'step') provider.pending.set(uri.toString(), cmd);
      await vscode.commands.executeCommand('vscode.openWith', uri, 'struktogramm.editor');
      return;
    }
    if (preview.panel && preview.panel.active) { preview.panel.webview.postMessage(msg); return; }
    if (provider.active) { provider.active.panel.webview.postMessage(msg); return; }
    if (cmd === 'run') vscode.window.showInformationMessage(t('ext.runHint'));
  }
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('struktogramm.editor', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(VIEW_ID, tools),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('struktogramm.toolbarLocation') || e.affectsConfiguration('struktogramm.devPreview.toolbarLocation')) applyToolbarLocation(true);
    }),
    vscode.commands.registerCommand('struktogramm.tools.resetLayout', () => tools.resetLayout()),
    vscode.commands.registerCommand('struktogramm.toggleToolbarLocation', async () => {
      const next = toolbarLocation() === 'sidebar' ? 'editor' : 'sidebar';
      const c = vscode.workspace.getConfiguration('struktogramm');
      await c.update('toolbarLocation', next, vscode.ConfigurationTarget.Global);
      // frühere Dev-Vorschau-Einstellung aufräumen
      if (c.inspect('devPreview.toolbarLocation')?.globalValue !== undefined) await c.update('devPreview.toolbarLocation', undefined, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('struktogramm.fromCode', (uri) => fromCode(uri, 'auto')),
    vscode.commands.registerCommand('struktogramm.fromCodeStructorizer', (uri) => fromCode(uri, 'structorizer')),
    vscode.commands.registerCommand('struktogramm.toCode', (uri) => toCode(uri, provider)),
    vscode.commands.registerCommand('struktogramm.newFile', (uri) => newFile(uri)),
    vscode.commands.registerCommand('struktogramm.preview', () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || !supportedLanguage(ed.document.languageId, ed.document.fileName)) { vscode.window.showWarningMessage(t('ext.previewLangs')); return; }
      preview.show(ed);
    }),
    vscode.commands.registerCommand('struktogramm.exportSvg', () => { const d = activeEditorDoc(); if (d) exportSvg(d); }),
    vscode.commands.registerCommand('struktogramm.exportPng', async () => {
      const a = provider.active;
      if (!a) return;
      try { await exportPng(a.document.uri, fromNsd(a.document.getText()), a.panel.webview); } catch (e) { vscode.window.showErrorMessage(t('ext.errorPrefix', e.message)); }
    }),
    vscode.commands.registerCommand('struktogramm.export', async (uri) => {
      try {
        // aus dem Explorer: .nsd-Datei ohne geöffneten Editor
        if (uri && uri.fsPath && /\.nsd$/i.test(uri.fsPath) && !(provider.active && provider.active.document.uri.toString() === uri.toString())) {
          const d = await vscode.workspace.openTextDocument(uri);
          await exportAs(null, d.uri, fromNsd(d.getText()), null, d);
          return;
        }
        const a = provider.active;
        if (a) await exportAs(null, a.document.uri, fromNsd(a.document.getText()), a.panel.webview, a.document);
      } catch (e) { vscode.window.showErrorMessage(t('ext.errorPrefix', e.message)); }
    }),
    ...['json', 'xml', 'aiClip'].map((f) => vscode.commands.registerCommand('struktogramm.export.' + f, async (uri) => {
      try {
        let d = provider.active ? provider.active.document : null;
        if (uri && uri.fsPath && /\.nsd$/i.test(uri.fsPath)) d = await vscode.workspace.openTextDocument(uri);
        if (d) await exportAs(f, d.uri, fromNsd(d.getText()), null, d);
      } catch (e) { vscode.window.showErrorMessage(t('ext.errorPrefix', e.message)); }
    })),
    vscode.commands.registerCommand('struktogramm.exportSingle', () => { const d = activeEditorDoc(); if (d) exportSingle(d); }),
    ...['run', 'step', 'pause', 'stop'].map((cmd) => vscode.commands.registerCommand('struktogramm.' + cmd, (uri) => execCommand(cmd, uri))),
    vscode.commands.registerCommand('struktogramm.openInStructorizer', async (uri) => {
      const u = await nsdUri(uri, provider);
      if (u) await openInStructorizer(await vscode.workspace.openTextDocument(u));
    }),
    vscode.commands.registerCommand('struktogramm.setupStructorizer', () => setupStructorizer(context)),
  );

  // Live-Code: ungespeicherter erzeugter Code folgt dem Struktogramm
  liveStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  liveStatus.command = 'struktogramm.stopLiveCode';
  context.subscriptions.push(
    liveStatus,
    vscode.commands.registerCommand('struktogramm.stopLiveCode', () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) endLive(ed.document.uri.toString(), t('ext.reasonStopped'));
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length || !liveLinks.size) return;
      const key = e.document.uri.toString();
      const own = liveLinks.get(key);
      // Handänderung im erzeugten Code -> Verbindung lösen (eigene Schreibvorgänge haben text === null)
      if (own && own.text !== null && e.document.getText() !== own.text) { endLive(key, t('ext.reasonEdited')); return; }
      scheduleLiveUpdate(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => endLive(d.uri.toString())),
    vscode.window.onDidChangeActiveTextEditor(() => updateLiveStatus()),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
