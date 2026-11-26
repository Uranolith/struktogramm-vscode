// Gemeinsames Übersetzen vieler Programme mit EINEM Compiler-Aufruf (Java, Kotlin, C#) – für Aufgaben- und Zufallstest.
// Der Kotlin-Compiler braucht für jeden Aufruf ≈ 13 s zum Hochfahren (große Java-VM-Anwendung, kein Daemon), dotnet build
// ≈ 6 s (MSBuild); ein weiteres Programm im selben Aufruf kostet dagegen nur Bruchteile einer Sekunde.
//
// Jedes Programm bekommt einen eigenen Namensraum, der Code bleibt sonst unverändert: Java und Kotlin `package pN`
// (Klasse weiterhin Program bzw. ProgKt), C# `namespace PN;` – so sieht kein Programm die Namen eines anderen.
// C# startet über ein kleines Startprogramm (BatchMain), das per Reflection die Main des gewünschten Programms aufruft.
// Schlägt das Übersetzen fehl, werden die Meldungen über den Dateinamen den Programmen zugeordnet; diese fallen heraus
// und der Rest wird neu übersetzt. Ausgeführt wird nur, was in einem erfolgreichen Lauf übersetzt wurde.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./languages');

const BATCH_LANGS = ['java', 'kotlin', 'csharp'];

const javaClass = new Map(); // id -> Klassenname (Java: Datei muss so heißen wie die öffentliche Klasse)

/** Datei eines Programms relativ zum Arbeitsordner der Sprache */
function fileFor(lang, id) {
  if (lang === 'java') return path.join('src', `p${id}`, `${javaClass.get(id) || 'Program'}.java`);
  if (lang === 'kotlin') return path.join('src', `p${id}`, 'prog.kt');
  return path.join('cs', `p${id}.cs`);
}

/** eigenen Namensraum einfügen (Kommentare und using/import davor bleiben erlaubt) */
function wrapCode(lang, id, code) {
  if (lang === 'java') return `package p${id};\n` + code;
  if (lang === 'kotlin') return `package p${id}\n` + code;
  // C#: dateiweiter Namensraum nach den using-Zeilen
  const lines = code.split('\n');
  let k = 0;
  for (let i = 0; i < lines.length; i++) if (/^\s*using\s+[\w.]+\s*;/.test(lines[i])) k = i + 1;
  lines.splice(k, 0, `namespace P${id};`);
  return lines.join('\n');
}

/** Arbeitsordner vorbereiten (C#: Projekt mit Startprogramm) */
function prepare(lang, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (lang !== 'csharp') return;
  fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cs/cs.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>' +
    '<TargetFramework>net8.0</TargetFramework><RollForward>Major</RollForward><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings>' +
    '<StartupObject>BatchMain</StartupObject><NoWarn>CS7022;CS0168;CS0219;CS0162</NoWarn></PropertyGroup></Project>');
  fs.writeFileSync(path.join(dir, 'cs/BatchMain.cs'), `using System;
using System.Reflection;
// Startprogramm: ruft die Main des Programms im angegebenen Namensraum auf (z. B. P12)
class BatchMain
{
    static void Main(string[] a)
    {
        const BindingFlags F = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
        MethodInfo m = null;
        foreach (var t in Assembly.GetExecutingAssembly().GetTypes())
            if (t.Namespace == a[0] && t.DeclaringType == null && (m = t.GetMethod("Main", F)) != null) break;
        try { m.Invoke(null, m.GetParameters().Length == 0 ? null : new object[] { new string[0] }); }
        catch (TargetInvocationException e) { Console.Out.Flush(); Console.Error.WriteLine(e.InnerException); Environment.Exit(1); }
    }
}
`);
}

/** Compiler-Aufruf für die übergebenen Dateien: [befehl, argumente, shell] */
function buildCmd(lang, dir, files) {
  if (lang === 'csharp') return ['dotnet', ['build', 'cs', '-nologo', '-v', 'q', '-o', 'cs/out']];
  // Dateiliste in einer Argumentdatei (Windows begrenzt die Länge der Befehlszeile)
  const list = path.join(dir, 'files.txt');
  fs.writeFileSync(list, files.map((f) => `"${f.replace(/\\/g, '/')}"`).join('\n') + '\n');
  if (lang === 'java') return ['javac', ['-encoding', 'UTF-8', '-d', 'jcls', '@files.txt']];
  return ['kotlinc', ['@files.txt', '-include-runtime', '-nowarn', '-d', 'batch.jar'], true];
}

/** Programm starten: [befehl, argumente] – mit absoluten Pfaden, damit jedes Programm in einem eigenen Ordner laufen kann */
function runCmd(lang, dir, id) {
  if (lang === 'java') return ['java', ['-Dstdout.encoding=UTF-8', '-cp', path.join(dir, 'jcls'), `p${id}.${javaClass.get(id) || 'Program'}`]];
  if (lang === 'kotlin') return ['java', ['-Dstdout.encoding=UTF-8', '-cp', path.join(dir, 'batch.jar'), `p${id}.ProgKt`]];
  return ['dotnet', [path.join(dir, 'cs/out/cs.dll'), `P${id}`]];
}

/** Fehlerzeilen eines gemeinsamen Übersetzens den Programmen zuordnen (javac meldet je nach Sprache „Fehler“) */
function errorsById(out) {
  const m = new Map();
  for (const line of String(out).replace(/\r/g, '').split('\n')) {
    const r = /(?:^|[\\/\s])p(\d+)(?:[\\/](?:Program\.java|prog\.kt)|\.cs)\b.*\b(?:error|fehler)\b/i.exec(line);
    if (r && !m.has(Number(r[1]))) m.set(Number(r[1]), line.trim());
  }
  return m;
}

/**
 * Alle Programme einer Sprache gemeinsam übersetzen.
 * @param {string} lang java | kotlin | csharp
 * @param {string} dir Arbeitsordner (wird angelegt)
 * @param {{id: number, code: string}[]} items
 * @returns {Promise<{ errors: Map<number, string>, ms: number }>} Übersetzungsfehler je Programm (fehlt = übersetzt)
 */
async function compileAll(lang, dir, items) {
  const t0 = Date.now();
  prepare(lang, dir);
  for (const it of items) {
    if (lang === 'java') javaClass.set(it.id, (/public\s+class\s+(\w+)/.exec(it.code) || [])[1] || 'Program');
    const f = path.join(dir, fileFor(lang, it.id));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, wrapCode(lang, it.id, it.code));
  }
  const errors = new Map();
  let todo = items.map((it) => it.id);
  let ok = false, last = '';
  for (let attempt = 0; todo.length && attempt < 8; attempt++) {
    const [cmd, a, shell] = buildCmd(lang, dir, todo.map((id) => fileFor(lang, id)));
    const r = await S.exec(cmd, a, { cwd: dir, shell: !!shell, timeout: 1800000 });
    if (r.status === 0) { ok = true; break; }
    last = (r.stdout || '') + (r.stderr || '');
    const all = (r.stdout || '') + (r.stderr || '');
    const errs = errorsById(all);
    const hit = todo.filter((id) => errs.has(id));
    if (!hit.length) { // nicht zuzuordnen: alle als fehlgeschlagen melden (nie stillschweigend als übersetzt)
      const msg = all.split('\n').find((l) => /error|fehler/i.test(l)) || 'Übersetzen fehlgeschlagen';
      for (const id of todo) errors.set(id, msg.trim());
      todo = [];
      break;
    }
    for (const id of hit) {
      errors.set(id, errs.get(id));
      if (lang === 'csharp') fs.rmSync(path.join(dir, fileFor(lang, id)), { force: true }); // C# übersetzt alle Dateien im Ordner
    }
    todo = todo.filter((id) => !errs.has(id));
  }
  // Versuche aufgebraucht, letzter Lauf ohne Erfolg: Rest gilt als nicht übersetzt
  if (!ok && todo.length) {
    const msg = last.split('\n').find((l) => /error|fehler/i.test(l)) || 'Übersetzen fehlgeschlagen';
    for (const id of todo) if (!errors.has(id)) errors.set(id, msg.trim());
  }
  return { errors, ms: Date.now() - t0 };
}

module.exports = { BATCH_LANGS, compileAll, runCmd };
