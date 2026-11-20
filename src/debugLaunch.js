'use strict';
/**
 * „Debugger“ für Struktogramme: macht Struktograf in der Debugger-Auswahl von VS Code (F5 ohne launch.json,
 * „Ausführen und Debuggen“) und in launch.json verfügbar. Es wird keine echte Debug-Sitzung gestartet:
 * das Struktogramm läuft wie mit F5 im Struktogramm-Editor, VS Code bricht den Start danach still ab.
 */
const vscode = require('vscode');
const path = require('path');
const { t } = require('./i18n');

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
    const uri = this.target(config, folder);
    if (!uri) {
      vscode.window.showInformationMessage(t('ext.runHint'));
      return undefined;
    }
    this.run(config && config.stopOnEntry ? 'step' : 'run', uri);
    // undefined: VS Code bricht den Debug-Start ohne Meldung ab – ausgeführt wird in Struktograf
    return undefined;
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
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(TYPE, provider),
    vscode.debug.registerDebugConfigurationProvider(TYPE, { provideDebugConfigurations: () => provider.provideDebugConfigurations() }, vscode.DebugConfigurationProviderTriggerKind.Dynamic),
  );
}

module.exports = { registerDebugger };
