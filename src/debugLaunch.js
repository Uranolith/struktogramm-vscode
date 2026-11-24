'use strict';
/**
 * Debugger für Struktogramme: macht Struktograf in der Debugger-Auswahl von VS Code (F5 ohne launch.json,
 * „Ausführen und Debuggen“, Strg+F5 „Ohne Debuggen ausführen“) und in launch.json verfügbar. Gestartet wird eine
 * echte Debug-Sitzung (Adapter in debugAdapter.js); ausgeführt wird im Struktogramm-Editor.
 * Unbenannte Struktogramme laufen ohne Sitzung (VS Code würde vor dem Start „Speichern unter“ verlangen).
 */
const vscode = require('vscode');
const path = require('path');
const { t } = require('./i18n');
const { registerDebugAdapter } = require('./debugAdapter');

const TYPE = 'struktogramm';

class StruktogrammDebugProvider {
  /**
   * @param editors NsdEditorProvider (offene Struktogramm-Editoren)
   * @param run (cmd, uri) => Promise – Ausführung starten bzw. Struktogramm öffnen und starten
   */
  constructor(editors, run) {
    this.editors = editors;
    this.run = run;
  }

  /** Welche .nsd soll laufen? launch.json-„program“, sonst laufende, zuletzt aktive oder irgendeine sichtbare */
  target(config, folder) {
    const prog = config && typeof config.program === 'string' ? config.program.trim() : '';
    if (prog && !prog.includes('${') && /\.nsd$/i.test(prog)) {
      const base = folder ? folder.uri.fsPath : (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath;
      return vscode.Uri.file(path.isAbsolute(prog) || !base ? prog : path.join(base, prog));
    }
    const ed = vscode.window.activeTextEditor;
    if (ed && /\.nsd$/i.test(ed.document.fileName)) return ed.document.uri;
    const pick = this.editors.execEditor && this.editors.editors.has(this.editors.execEditor) ? this.editors.execEditor
      : this.editors.active || [...this.editors.editors].find((s) => s.panel.visible) || [...this.editors.editors][0];
    if (pick) return pick.document.uri;
    const doc = vscode.workspace.textDocuments.find((d) => /\.nsd$/i.test(d.fileName));
    return doc ? doc.uri : null;
  }

  resolveDebugConfiguration(folder, config) {
    // nachträglich angehängte Sitzung (Ausführung wurde im Editor gestartet)
    if (config && config.__attach) return config;
    const uri = this.target(config, folder);
    if (!uri) {
      vscode.window.showInformationMessage(t('ext.runHint'));
      return undefined;
    }
    if (uri.scheme !== 'file') {
      // unbenannt: ohne Debug-Sitzung ausführen; undefined bricht den Start in VS Code still ab
      this.run(config && config.stopOnEntry ? 'step' : 'run', uri, { noDebug: !!(config && config.noDebug) });
      return undefined;
    }
    return {
      ...config,
      type: TYPE,
      request: 'launch',
      name: config.name || t('ext.debugConfigName', path.basename(uri.fsPath)),
      program: uri.fsPath,
      __uri: uri.toString(),
      // die Ausgabe steht im Struktograf-Panel (mit Eingabe) – die Debugkonsole nicht automatisch davorschieben
      internalConsoleOptions: config.internalConsoleOptions || 'neverOpen',
    };
  }

  /** Einträge für „Ausführen und Debuggen“ (dynamisch): je offenes Struktogramm einer */
  provideDebugConfigurations() {
    const seen = new Set();
    const out = [];
    for (const s of this.editors.editors) {
      const p = s.document.uri.fsPath;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ type: TYPE, request: 'launch', name: t('ext.debugConfigName', path.basename(p)), program: p });
    }
    return out;
  }
}

function registerDebugger(context, editors, run) {
  const provider = new StruktogrammDebugProvider(editors, run);
  registerDebugAdapter(context, editors, run);
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(TYPE, provider),
    vscode.debug.registerDebugConfigurationProvider(TYPE, { provideDebugConfigurations: () => provider.provideDebugConfigurations() }, vscode.DebugConfigurationProviderTriggerKind.Dynamic),
  );
}

module.exports = { registerDebugger };
