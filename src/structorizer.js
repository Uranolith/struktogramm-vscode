'use strict';
/**
 * Anbindung an das Original-Structorizer (https://github.com/fesch/Structorizer.Desktop, GPL-3.0)
 * über dessen Kommandozeile:
 *   java -jar Structorizer.jar -x <Generator> ...   (Struktogramm -> Code)
 *   java -jar Structorizer.jar -p ...               (Code -> Struktogramm)
 * Structorizer wird nicht mitgeliefert, sondern auf Wunsch von GitHub heruntergeladen.
 */
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const cp = require('child_process');
const { rootToNsd, fromNsd } = require('./core/nsdxml');
const { clone } = require('./core/model');
const { modernize, toStructorizer, splitInstructions } = require('./core/style');
const { parseSignature } = require('./core/pseudo');

const { t } = require('./i18n');

/** Structorizer-Generatoren (Name für -x, Anzeige, VS-Code-Sprache) */
const GENERATORS = [
  ['Python', 'Python', 'python'], ['Java', 'Java', 'java'], ['C', 'C', 'c'], ['C++', 'C++', 'cpp'],
  ['C#', 'C#', 'csharp'], ['Javascript', 'JavaScript', 'javascript'], ['Pascal', 'Pascal', 'pascal'],
  ['Delphi', 'Delphi (Object Pascal)', 'pascal'], ['Oberon', 'Oberon', 'plaintext'], ['PHP', 'PHP', 'php'],
  ['Perl', 'Perl', 'perl'], ['Basic', 'BASIC', 'vb'], ['BASH', 'Bash', 'shellscript'], ['KSH', 'Korn Shell', 'shellscript'],
  ['ARM', 'ARM Assembler', 'plaintext'], ['StrucTeX', 'StrucTeX (LaTeX)', 'latex'], ['LaTeX', 'LaTeX (algorithmic)', 'latex'],
  ['Algorithm', 'LaTeX (algorithm)', 'latex'],
].map(([id, label, languageId]) => ({ id, label, languageId }));

/** Quelltext-Endungen, die Structorizer importieren kann */
const IMPORT_EXT = ['pas', 'dpr', 'pp', 'lpr', 'c', 'java', 'pde', 'cob', 'cbl', 'cobol', 'cpy'];

let output = null;
function log(msg) {
  if (!output) output = vscode.window.createOutputChannel(t('str.outputChannel'));
  output.appendLine(msg);
}

function cfg() { return vscode.workspace.getConfiguration('struktogramm.structorizer'); }

/* ------------------------------ Java ------------------------------ */
function javaCmd() { return cfg().get('javaPath') || 'java'; }

function run(args, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const full = ['-Dfile.encoding=UTF-8', '-Djava.awt.headless=true', ...args];
    log(`> ${javaCmd()} ${full.join(' ')}`);
    cp.execFile(javaCmd(), full, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (stdout) log(stdout.trimEnd());
      if (stderr) log(stderr.trimEnd());
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, error: err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function javaVersion() {
  return new Promise((resolve) => {
    cp.execFile(javaCmd(), ['-version'], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && !stderr) return resolve(null);
      const m = /version "(\d+)(?:\.(\d+))?/.exec(stderr || stdout || '');
      if (!m) return resolve(null);
      resolve(m[1] === '1' ? parseInt(m[2], 10) : parseInt(m[1], 10));
    });
  });
}

/* ------------------------------ Download ------------------------------ */
function get(url, binary) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'struktogramm-vscode', Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(get(res.headers.location, binary)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(t('str.httpError', res.statusCode, url))); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(120000, () => req.destroy(new Error(t('str.timeout'))));
    req.on('error', reject);
  });
}

/** Minimaler ZIP-Leser: liefert den Inhalt eines Eintrags, dessen Name auf suffix endet */
function unzipEntry(buf, suffix) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(t('str.badZip'));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(t('str.badZipDir'));
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name.endsWith(suffix)) {
      const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
      return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

async function download(context) {
  const dir = path.join(context.globalStorageUri.fsPath, 'structorizer');
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('str.downloading') }, async (progress) => {
    progress.report({ message: 'suche aktuelle Version auf GitHub' });
    const rel = JSON.parse((await get('https://api.github.com/repos/fesch/Structorizer.Desktop/releases/latest')).toString('utf8'));
    const asset = (rel.assets || []).find((a) => /^structorizer_[\d.\-]+\.zip$/i.test(a.name));
    if (!asset) throw new Error(t('str.noAsset', rel.tag_name));
    progress.report({ message: `${asset.name} (${Math.round(asset.size / 1e6)} MB)` });
    const zip = await get(asset.browser_download_url, true);
    const jar = unzipEntry(zip, 'Structorizer.jar');
    if (!jar) throw new Error(t('str.noJarInPackage'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Structorizer.jar'), jar);
    const lic = unzipEntry(zip, 'license.txt');
    if (lic) fs.writeFileSync(path.join(dir, 'license.txt'), lic);
    fs.writeFileSync(path.join(dir, 'version.txt'), rel.tag_name);
    log(`Structorizer ${rel.tag_name} installiert in ${dir}`);
    return path.join(dir, 'Structorizer.jar');
  });
}

/** Pfad zur Structorizer.jar (aus Einstellung, Download-Ordner oder null) */
function findJar(context) {
  const p = cfg().get('jarPath');
  const cand = [];
  if (p) {
    cand.push(p, path.join(p, 'Structorizer.jar'), path.join(p, 'Structorizer.app', 'Contents', 'Java', 'Structorizer.jar'),
      path.join(p, 'Structorizer', 'Structorizer.app', 'Contents', 'Java', 'Structorizer.jar'));
  }
  cand.push(path.join(context.globalStorageUri.fsPath, 'structorizer', 'Structorizer.jar'));
  return cand.find((c) => /\.jar$/i.test(c) && fs.existsSync(c)) || null;
}

/** Stellt sicher, dass Java und Structorizer verfügbar sind. Liefert den JAR-Pfad oder null. */
async function ensure(context, interactive = true) {
  const v = await javaVersion();
  if (!v || v < 11) {
    if (interactive) {
      const msg = v ? t('str.javaTooOld', v) : t('str.javaMissing');
      const c = await vscode.window.showErrorMessage(msg, t('str.downloadJava'), t('str.setJavaPath'));
      if (c === t('str.downloadJava')) vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/'));
      if (c === t('str.setJavaPath')) vscode.commands.executeCommand('workbench.action.openSettings', 'struktogramm.structorizer.javaPath');
    }
    return null;
  }
  let jar = findJar(context);
  if (jar) return jar;
  if (!interactive) return null;
  const c = await vscode.window.showInformationMessage(
    t('str.needed'),
    { modal: true }, t('str.download'), t('str.chooseExisting'));
  if (c === t('str.download')) {
    try { jar = await download(context); } catch (e) { vscode.window.showErrorMessage(t('ext.downloadFailed', e.message)); return null; }
    return jar;
  }
  if (c === t('str.chooseExisting')) {
    const pick = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, openLabel: t('str.chooseStructorizer'), filters: { [t('str.jarOrFolder')]: ['jar'] } });
    if (!pick || !pick[0]) return null;
    await cfg().update('jarPath', pick[0].fsPath, vscode.ConfigurationTarget.Global);
    jar = findJar(context);
    if (!jar) vscode.window.showErrorMessage(t('str.noJarThere'));
    return jar;
  }
  return null;
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'struktogramm-')); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ } }

/** Diagramme als einzelne .nsd-Dateien schreiben; liefert die Dateinamen */
function writeRoots(model, dir) {
  model = toStructorizer(clone(model)); // Structorizer erwartet Zuweisungen mit <-
  const used = new Set();
  const files = [];
  for (const r of model.roots) {
    let name = parseSignature(r.text).name.replace(/[^\p{L}\p{N}_-]/gu, '_') || 'diagramm';
    while (used.has(name.toLowerCase())) name += '_';
    used.add(name.toLowerCase());
    const f = name + '.nsd';
    fs.writeFileSync(path.join(dir, f), rootToNsd(r), 'utf8');
    files.push(f);
  }
  return files;
}

/** Struktogramm -> Code mit einem Structorizer-Generator */
async function exportCode(context, model, generatorId) {
  const jar = await ensure(context);
  if (!jar) return null;
  const dir = tmpDir();
  try {
    const files = writeRoots(model, dir);
    const extra = cfg().get('exportOptions') || [];
    // Ausgabedatei nach dem Hauptprogramm benennen (bestimmt z.B. Klassen-/Unit-Namen)
    const mainIdx = Math.max(0, model.roots.findIndex((r) => r.rootType === 'program'));
    const outBase = files[mainIdx].replace(/\.nsd$/, '');
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir);
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('str.generating', generatorId) },
      () => run(['-jar', jar, '-x', generatorId, '-f', '-e', 'UTF-8', ...extra, '-o', path.join(outDir, outBase + '.code'), ...files], dir));
    const out = fs.readdirSync(outDir)[0];
    if (!out) throw new Error(t('str.noCode') + (res.stderr ? '\n' + res.stderr.trim().split('\n').slice(-3).join('\n') : ''));
    let code = fs.readFileSync(path.join(outDir, out), 'utf8');
    // doppelte Schnittmarken (Name der Ausgabedatei) entfernen; bei nur einem Diagramm alle
    const esc = outBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = new RegExp(`8< -+ ${esc}\\.|8< =+ ${esc}\\.[^ ]* =+\\s*$`);
    // Structorizer setzt nach jeder Schnittmarke noch eine mit dem Ausgabedateinamen – die zweite entfällt
    let prevMarker = false;
    code = code.split(/\r?\n/).filter((l) => {
      const marker = /8< [=-]+/.test(l);
      if (!l.trim()) return true;
      let keep = true;
      if (marker && (files.length === 1 || /8< -+/.test(l) || (dup.test(l) && prevMarker))) keep = false;
      prevMarker = marker;
      return keep;
    }).join('\n');
    return code.replace(/^\s+/, '');
  } finally { cleanup(dir); }
}

/** Code -> Struktogramm mit den Structorizer-Parsern (C, Java, Pascal, COBOL, Processing) */
async function importCode(context, srcText, fileName) {
  const jar = await ensure(context);
  if (!jar) return null;
  const dir = tmpDir();
  try {
    const base = path.basename(fileName).replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_-]/gu, '_') || 'programm';
    const ext = (/\.([^.]+)$/.exec(fileName) || [])[1] || 'c';
    const src = path.join(dir, `${base}.${ext}`);
    fs.writeFileSync(src, srcText, 'utf8');
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('str.reading') },
      () => run(['-jar', jar, '-p', '-f', '-e', 'UTF-8', '-o', path.join(dir, base + '.nsd'), src], dir));
    const nsds = fs.readdirSync(dir).filter((f) => f.endsWith('.nsd'));
    if (!nsds.length) {
      const errLines = (res.stdout + '\n' + res.stderr).split(/\r?\n/).filter((l) => /error|fehler|exception|unexpected|line/i.test(l)).slice(0, 6);
      throw new Error(t('str.importFailed') + (errLines.length ? '\n' + errLines.join('\n') : t('str.seeOutput')));
    }
    nsds.sort((a, b) => (a === base + '.nsd' ? -1 : b === base + '.nsd' ? 1 : a.localeCompare(b)));
    const roots = [];
    for (const f of nsds) roots.push(...fromNsd(fs.readFileSync(path.join(dir, f), 'utf8')).roots);
    const keep = roots.filter((r) => !(r.rootType === 'includable' && !r.children.length));
    keep.sort((a, b) => (a.rootType === 'program' ? 0 : 1) - (b.rootType === 'program' ? 0 : 1));
    return splitInstructions(modernize({ roots: keep }));
  } finally { cleanup(dir); }
}

/** Diagramm(e) im Original-Structorizer öffnen */
async function openInStructorizer(context, model, docPath) {
  const jar = await ensure(context);
  if (!jar) return;
  let args;
  let cwd;
  // Datei direkt öffnen, wenn sie schon in Structorizer-Schreibweise vorliegt – sonst umgewandelte Kopie
  const same = JSON.stringify(toStructorizer(clone(model))) === JSON.stringify(model);
  if (same && model.roots.length === 1 && docPath && fs.existsSync(docPath)) { args = [docPath]; cwd = path.dirname(docPath); }
  else {
    if (!same) vscode.window.showInformationMessage(t('str.opensCopy'));
    const dir = path.join(os.tmpdir(), 'struktogramm-structorizer-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    args = writeRoots(model, dir).map((f) => path.join(dir, f));
    cwd = dir;
  }
  const child = cp.spawn(javaCmd(), ['-jar', jar, ...args], { cwd, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (e) => vscode.window.showErrorMessage(t('str.startFailed', e.message)));
  child.unref();
}

module.exports = { GENERATORS, IMPORT_EXT, ensure, download, exportCode, importCode, openInStructorizer, findJar, unzipEntry };
