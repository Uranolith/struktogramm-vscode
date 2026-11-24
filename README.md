# Struktograf – Nassi-Shneiderman-Struktogramme für VS Code

Struktogramm-Editor im Stil von **Structorizer**, direkt in VS Code.

> **Preview.** Die Extension ist im
> [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Uranolith.struktogramm)
> veröffentlicht, befindet sich aber noch in aktiver Entwicklung.

## Installation
Voraussetzung: VS Code 1.80 oder neuer. Java 11+ wird nur für die optionalen Original-Structorizer-Funktionen gebraucht.

- In VS Code die Ansicht **Erweiterungen** öffnen (Strg+Umschalt+X), nach **Struktograf** suchen und
  **Installieren** klicken.
- Oder im Terminal:
  ```
  code --install-extension Uranolith.struktogramm
  ```
- Oder über die [Marketplace-Seite](https://marketplace.visualstudio.com/items?itemName=Uranolith.struktogramm).

Updates installiert VS Code automatisch. Deinstallieren geht über **Erweiterungen** → *Struktograf* →
**Deinstallieren** oder mit `code --uninstall-extension Uranolith.struktogramm`.

## Funktionen
- **Neues Struktogramm**: *Datei → Neue Datei... → Neues Struktogramm...*, Rechtsklick auf einen Ordner im Explorer,
  das Symbol oben in der Explorer-Leiste oder *Neues Struktogramm...* in der Werkzeug-Ansicht *Struktograf*.
  Nach Eingabe des Namens öffnet sich die neue `.nsd`-Datei mit einem leeren Hauptprogramm.
- **Sprache**: Oberfläche auf Englisch oder Deutsch, je nach Anzeigesprache von VS Code (*Configure Display Language*).
- **Arbeitsbereich**: Die Werkzeuge stehen in der Werkzeugleiste oben im Struktogramm-Editor, die Ausführung
  (Konsole, Eingabe, Turtleizer, Variablen) im Panel **Struktograf** unten neben *Probleme* und *Ausgabe*.
  Mit `struktogramm.toolbarLocation` = `sidebar` stehen die Werkzeuge stattdessen in der Ansicht **Struktograf**
  (Symbol links in der Aktivitätsleiste), mit `struktogramm.executionPanelLocation` = `editor` steht die Ausführung
  im Editor – beides lässt sich auch live über die Knöpfe in den Titelleisten umschalten. Die Kategorien der
  Werkzeug-Ansicht lassen sich ein- und ausklappen und per Drag & Drop (oder Alt+↑/↓) umsortieren.
  Die Bereiche der Ausführungsanzeige (Konsole, Turtleizer, Variablen/Aufrufe) lassen sich an den Trennlinien
  breiter und schmaler ziehen.
- **Code → Struktogramm**: Python, Java, C, C++, C#, JavaScript, TypeScript, Kotlin, Rust
  (Rechtsklick im Editor → *Struktogramm aus Code erzeugen*; mit Markierung nur der markierte Teil).
  Jede Funktion wird ein eigenes Diagramm, `main` bzw. Code auf oberster Ebene wird das Hauptprogramm.
- **Live-Vorschau**: Symbol oben rechts im Code-Editor – das Struktogramm aktualisiert sich beim Tippen.
- **Grafischer Editor** für `.nsd`-Dateien: Elemente einfügen, bearbeiten (Doppelklick), ziehen,
  kopieren/einfügen, Kontextmenü, Farben, Kommentare, Rückgängig.
- **Struktogramm → Code**: Python, Java, C, C++, C#, JavaScript (Node.js), Pascal, Kotlin, Rust.
  - **Live-Code**: Der erzeugte Code öffnet sich als ungespeichertes Dokument und folgt jeder Änderung am
    Struktogramm. In der Statusleiste steht dann *Live: datei.nsd*. Die Verbindung endet, sobald du den Code
    speicherst, selbst bearbeitest oder schließt; ein Klick auf die Statusanzeige beendet sie sofort.
    Das gilt für die eigene Übersetzung, nicht für die Structorizer-Generatoren.
  - Kotlin: `readln()` für Eingaben, String-Templates für Ausgaben, `IntArray`/`intArrayOf`, `when`, `downTo`/`step`.
  - Rust: `println!`, eine kleine `read_line()`-Hilfsfunktion für Eingaben, `Vec`, `match`, `loop`;
    ganze Zahlen werden in Rechnungen mit Kommazahlen automatisch als `2.0` geschrieben.
- **Ausführen** (wie der Structorizer-Executor): Ausführen, Einzelschritt, Anhalten, Beenden; Tempo langsam
  (400 ms), mittel (200 ms), schnell (50 ms) oder sofort; Haltepunkte (F9 oder Rechtsklick). Das gerade ausgeführte
  Element ist markiert und bleibt im Bild, Fehler werden am Element rot markiert. Unterprogramme und Rekursion
  werden unterstützt; funktioniert auch in der Live-Vorschau von Quelltext.
  - **Konsole** mit Ein- und Ausgabe (bei `INPUT` steht der Cursor direkt im Eingabefeld), daneben die
    Turtleizer-Zeichnung.
  - Reiter **Variablen**: laufende Aufrufe und darunter alle abgeschlossenen Aufrufe mit Endzustand und
    Rückgabewert; mehrfache Aufrufe sind nummeriert (`summe #1`, `summe #2` …).
  - Reiter **Aufrufe**: Aufrufstapel und Aufrufverlauf als Baum mit Argumenten und Rückgabewerten; ein Klick
    springt zu den Variablen des Aufrufs.
  - **Debuggen mit VS Code**: Jede Ausführung eines gespeicherten Struktogramms ist eine echte Debug-Sitzung –
    mit der Debug-Leiste (Fortsetzen, Schritt über, Schritt hinein, Rücksprung, Anhalten, Neustart, Beenden),
    Variablen und Aufrufliste in *Ausführen und Debuggen*, Ausdrücken unter *Überwachen* und in der Debugkonsole.
    Wartet das Programm auf `INPUT`, kann man den Wert auch in der Debugkonsole eingeben. *Ohne Debuggen ausführen*
    (Strg+F5) ignoriert die Haltepunkte.
  - **Haltepunkte** (F9 im Struktogramm) sind echte VS-Code-Haltepunkte: Sie stehen in der Ansicht *Haltepunkte*,
    lassen sich dort aktivieren, deaktivieren und entfernen und bleiben gespeichert. Über das Kontextmenü im
    Struktogramm bekommen sie eine **Bedingung** (`i > 5`), eine **Trefferzahl** (`3`, `>= 3`, `% 2`) oder werden zum
    **Logpoint** (schreibt `i = {i}` in die Debugkonsole, ohne anzuhalten). **Funktionshaltepunkte** (Name eines
    Unterprogramms) halten beim Aufruf. *Bei Laufzeitfehlern anhalten* (Ansicht *Haltepunkte*) zeigt Variablen und
    Aufrufliste an der Fehlerstelle. Im Diagramm: rot = Haltepunkt, gestrichelt = mit Bedingung, orange = Logpoint,
    grau = deaktiviert.
  - **Aufrufliste** mit dem Element und seiner Zeile in der `.nsd`; ein Klick auf einen Aufruf markiert die Stelle im
    Struktogramm. **Variablen**: Felder und Records lassen sich aufklappen, Werte ändern (*Wert festlegen*, ein
    Ausdruck). Die Debugkonsole schlägt Variablen und Unterprogramme vor.
  - Wie bei anderen Debuggern
    speichert VS Code die Datei vor dem Start (`debug.saveBeforeStart`); unbenannte Struktogramme laufen ohne
    Debug-Sitzung.
- **Original-Structorizer** (optional, benötigt Java 11+): wird beim ersten Gebrauch von GitHub
  heruntergeladen (Befehl *Structorizer herunterladen oder einrichten...*).
  - *Code aus Struktogramm erzeugen...* bietet zusätzlich alle 18 Structorizer-Generatoren an (u.a. PHP, Perl, BASIC,
    Bash, Oberon, Delphi, LaTeX/StrucTeX).
  - Pascal/Delphi-, COBOL- und Processing-Dateien werden mit dem Structorizer-Parser eingelesen;
    für C/Java gibt es *Struktogramm aus Code erzeugen (Structorizer-Parser)*.
  - *Im Structorizer öffnen* startet die Structorizer-Oberfläche mit dem Diagramm.
- **Export** als SVG, PNG, JSON, XML, KI-kompakter Pseudocode und einzelne Structorizer-Dateien (siehe [Export](#export)).
- **Structorizer-kompatibel**: liest und schreibt `.nsd` (XML) in Structorizer-Schreibweise. Eine Datei mit
  einem Diagramm öffnet der Structorizer direkt. Dateien mit mehreren Diagrammen (z.B. nach einem
  Code-Import mit Funktionen) kann der Structorizer nicht lesen. Teile sie mit *Diagramme einzeln als
  Structorizer-Dateien speichern* auf.

## Schreibweise im Struktogramm
Die Diagramme verwenden die Schreibweise des Original-Structorizers: Zuweisung `:=`, Vergleich `=` und `<>`.
Eine `.nsd`-Datei mit einem Diagramm lässt sich daher unverändert im Structorizer öffnen.

Andere Schreibweisen werden beim Speichern automatisch umgestellt: `x = 5` und `x <- 5` werden zu `x := 5`,
`==` wird zu `=`, `!=` zu `<>`. Das gilt für Eingaben im Editor, für Code-Importe und für Dateien älterer
Versionen dieser Extension.

Geteilt wird immer mit `/`. Zwischen zwei ganzen Zahlen rechnet `/` ganzzahlig (`7 / 2` ergibt `3`).
Ein `div` aus importiertem Code wird zu `/`.

| Element | Beispiel |
|---|---|
| Zuweisung | `x := 5` |
| Deklaration | `var x: int` · `var x: int := 0` · `const MAX := 10` |
| Eingabe / Ausgabe | `INPUT "Zahl: ", x` · `OUTPUT "Summe: ", s` |
| Bedingung | `x > 3 and y <> 0` · Vergleich `x = 0` |
| Zählschleife | `for i := 1 to 10 by 2` · `foreach x in liste` |
| Kopf-/Fußschleife | `while x > 0` · `until x = 0` |
| Fallauswahl | 1. Zeile Ausdruck, dann je Fall eine Zeile, letzte Zeile `default` (oder `%`) |
| Sprung | `leave` · `leave 2` (zwei Schleifen) · `return x` · `exit 0` · `throw "Fehler"` |
| Try | Element *Try*: Text = Name der Fehlervariable; Blöcke `try`, `catch fehler`, `finally` |
| Typdefinition | `type Punkt = record{x: int; y: int}` · `type Farbe = enum{ROT, GRUEN = 5, BLAU}` |
| Record | `p := Punkt{x: 3, y: 4}` · `var q: Punkt` · `q.x := 7` |
| Prozeduren | `inc(x)` · `dec(x, 2)` · `insert("ab", s, 3)` · `delete(s, 1, 2)` · `randomize()` |

## Befehlssatz des Structorizers
Ausführung, Hervorhebung und Autovervollständigung kennen den Befehlssatz des Original-Structorizers
(Executor und Turtleizer):

| Bereich | Befehle |
|---|---|
| Mathematik | `abs` `min` `max` `round` `ceil` `floor` `sgn` `signum` `sqr` `sqrt` `exp` `log` `pow` `sin` `cos` `tan` `asin` `acos` `atan` `toRadians` `toDegrees` `random(n)` `randomize()` |
| Zeichenketten | `length` `pos` `copy` `insert` `delete` `lowercase` `uppercase` `trim` `split` `strcmp` `ord` `chr` |
| Prüfen / Kopieren | `isArray` `isString` `isChar` `isBool` `isNumber` `copyArray` `copyRecord` |
| Prozeduren | `inc(x)` `inc(x, d)` `dec(x)` `dec(x, d)` `insert(w, s, i)` `delete(s, i, n)` |
| Dateien | `fileOpen` `fileCreate` `fileAppend` `fileClose` `fileEOF` `fileRead` `fileReadChar` `fileReadInt` `fileReadDouble` `fileReadLine` `fileWrite` `fileWriteLine` – relative Pfade gelten ab dem Ordner der `.nsd`-Datei |
| Turtleizer | `forward` `backward` `left` `right` `gotoXY` `gotoX` `gotoY` `penUp` `penDown` `hideTurtle` `showTurtle` `setPenColor(r, g, b)` `setBackground(r, g, b)` `clear` `getX` `getY` `getOrientation` – die Zeichnung erscheint neben der Konsole |
| Elemente | Anweisung, Verzweigung, Fallauswahl, Zähl-/Kopf-/Fuß-/Endlosschleife, Aufruf, Sprung, Try, Parallel; eingebundene Diagramme (`includeList` von Includable-Diagrammen) |

Beim Erzeugen von Code werden diese Befehle in die Zielsprache übersetzt, z.B. `uppercase(s)` →
`s.upper()` (Python) / `s.toUpperCase()` (Java), `try` → `try/catch/finally` (in C mit `setjmp`, in Rust mit
`catch_unwind`), Records → Klassen/Structs, `leave 2` → `break L1` bzw. `goto`. Eine Fallauswahl mit `true` als Ausdruck und
Bedingungen als Marken (`case true of  kdnr < 2000: …`) wird zu `switch (true)` (JavaScript),
`switch (true) { case true when … }` (C#), `when { … }` (Kotlin) bzw. `match true { _ if … }` (Rust); in Java, C, C++,
Pascal und Python, wo `case`-Marken Konstanten sein müssen, zu einer `if / else if`-Kette. Turtle-Befehle werden für
Python in das Modul `turtle` übersetzt; die Datei-API wird nur ausgeführt, nicht übersetzt.

**Parallelverarbeitung** wird zu echten Threads: Python `threading`, Java je Zweig eine Thread-Klasse,
C# `Parallel.Invoke`, C++ `std::thread`, C OpenMP (`#pragma omp parallel sections`, mit `-fopenmp` übersetzen),
Kotlin `thread { }`, Rust `std::thread::scope`, Pascal `BeginThread`. Das Programm wartet, bis alle Zweige
fertig sind. In Java arbeitet jeder Zweig mit Kopien der Variablen, geänderte Werte werden danach übernommen.
Beim Ausführen im Editor laufen die Zweige dagegen nacheinander. Ein Beispiel mit allen Elementen, Rekursion und
Parallelverarbeitung ist `test/samples/gesamttest.nsd`.

Schlüsselwörter (blau, fett), Funktionsaufrufe (dunkelgelb, fett), Datentypen (petrol), Zeichenketten (rot),
Operatoren (lila, fett: Zuweisung `:=`, Vergleiche `=` `<>` `<` `>` `≤` `≥`, Rechnen `+ - * / %` `mod`) werden im Diagramm farbig
dargestellt; abschalten mit der Einstellung `struktogramm.highlightKeywords`.

## Hell / Dunkel
Das Struktogramm passt sich dem VS-Code-Farbschema an: bei einem dunklen Theme wird es dunkel
dargestellt, sonst hell (Einstellung `struktogramm.theme`: `auto`, `light`, `dark`). Elementfarben
werden im dunklen Schema als dunkle Variante desselben Farbtons gezeigt. Beim Export als SVG oder PNG
wird gefragt, ob das Bild hell oder dunkel werden soll (`struktogramm.exportTheme`: `ask`, `editor`,
`light`, `dark`).

## Export
**Exportieren...** (Werkzeug-Ansicht, Titelleiste des Editors, Explorer-Kontextmenü) bietet:

| Format | Zweck |
|---|---|
| SVG / PNG | Bild, hell oder dunkel |
| JSON | vollständige Struktur (`diagrams[].body[]` mit `type`, `text`, `condition`, `then`/`else`, `body`, `branches` …) |
| XML | dieselbe Struktur als einfaches XML (`<if><condition/><then/><else/></if>` …) |
| KI-kompakt | token-sparender Pseudocode für KI-Agents – in die Zwischenablage oder als `.ki.txt` (Menü *Exportieren...* oder Befehl *KI-Pseudocode in die Zwischenablage kopieren*) |
| Structorizer-Dateien | je Diagramm eine `.nsd` für den Original-Structorizer |

KI-kompakt nutzt Einrückung mit einem Leerzeichen statt Klammern/Tags und ist etwa 6–8× kürzer als JSON:
```
PROGRAM rechner
INPUT "Zahl: ", zahl
for i := 1 to zahl
 s := s + i
if ist_prim(zahl)
 OUTPUT zahl, " ist prim"
else
 OUTPUT "nein"
FUNCTION summe(a: int; b: int): int # Addiert zwei Zahlen.
return a + b
```

## Tastatur im Editor
**F5** ausführen / fortsetzen · **F10** Schritt über · **F11** Schritt hinein · **Umschalt+F11** Rücksprung ·
**F6** anhalten · **Umschalt+F5** beenden · **Strg+F5** ohne Debuggen · **F9** Haltepunkt.
Im Explorer: Rechtsklick auf eine `.nsd` → *Ausführen oder fortsetzen*.
Im Struktogramm-Editor startet F5 das Struktogramm als Debug-Sitzung; während der Sitzung gelten die Debug-Tasten
von VS Code überall. Dazu gibt es oben rechts im Editor das Ausführen-Menü (▷) mit *Struktogramm debuggen* und
*Struktogramm ohne Debuggen ausführen* sowie dieselben Links in der leeren Ansicht *Ausführen und Debuggen*.
Außerhalb des Struktogramm-Editors entscheidet VS Code wie gewohnt, was F5 startet (`launch.json` bzw. der Debugger
der aktiven Datei). Die Debugger-Auswahl von VS Code erkennt den Struktogramm-Editor nicht als Dateityp; dort steht
*▶ Struktogramm ausführen (Struktograf)* zwischen den anderen Debuggern (nach dem ersten Start oben unter den zuletzt
verwendeten).

Der Editor ist vollständig per Tastatur bedienbar; **?** zeigt alle Tastenkürzel.

**Mac:** ⌘ statt Strg (z.B. ⌘↑/↓ verschieben, ⌘Enter einfügen, ⇧⌘Enter davor einfügen), ⌫ löscht,
Fn+← / Fn+→ und Fn+↑ / Fn+↓ ersetzen Pos1/Ende und Bild↑/↓. Im Bearbeiten-Dialog öffnet neben ⌃Leertaste auch ⌘I die
Vorschläge. Tooltips, Statuszeile und die Übersicht (**?**) zeigen auf dem Mac automatisch die Mac-Tasten.
Die Zoom-Tasten (Strg/⌘ + `+` / `−` / `0`) zoomen nur das Struktogramm, solange es den Fokus hat – nicht zusätzlich
die ganze VS-Code-Oberfläche.

| Taste | Wirkung |
|---|---|
| ↑ / ↓ | vorheriges / nächstes Element (am Blockende weiter hinter dem umgebenden Element, bei Try: try → catch → finally) |
| → / ← | Nachbarzweig rechts / links auf gleicher Höhe: Fälle, true/false, parallele Zweige – auch aus verschachtelten Elementen heraus; ohne Nachbarn hinein in den ersten Block / hinaus zum umgebenden Element |
| Strg + → / ← | immer hinein in den ersten Block / hinaus zum umgebenden Element (z.B. in eine Schleife in einem mittleren Fall) |
| Pos1 / Ende · Bild ↑ / ↓ | erstes / letztes Element im Block · vorheriges / nächstes Diagramm |
| Enter / F2 | bearbeiten (im leeren Block: Anweisung einfügen) |
| Strg+Enter / Einfg | **Einfügen mit Vorschau:** An der Einfügestelle öffnet sich eine Auswahl; Tippen filtert nach Name, Kürzel oder Stichwort (**I** Anweisung, **V** Verzweigung, **F** Fallauswahl, **Z** Zählschleife, **K** Kopfschleife, **U** Fußschleife, **E** Endlosschleife, **A** Aufruf, **S** Sprung, **T** Try, **P** Parallel – oder `if`, `while`, `try` …). Das gewählte Element erscheint gestrichelt als Vorschau im Diagramm. ↑/↓ wählt, **Enter** fügt ein, ein weiteres **Enter** öffnet die Detailbearbeitung, Esc bricht ab. Strg+Umschalt+Enter bzw. Umschalt+Einfg fügt davor ein. |
| Umschalt+F10 / Menütaste | Kontextmenü (Umschließen, Deaktivieren …) – Menüs mit ↑/↓, Enter, →/←, Esc |
| Leertaste | Element aktivieren / deaktivieren |
| Entf · Strg+↑/↓ · Strg+C/X/V | löschen · verschieben · kopieren/ausschneiden/einfügen |
| Strg + + / − / 0 · Strg+Mausrad | Zoom |
| Tab | Werkzeugleiste und Ausführungsbereich erreichen, sofern sie im Editor angezeigt werden; Esc in der Konsoleneingabe springt zurück ins Diagramm |

Die Statusleiste nennt das ausgewählte Element samt Zweig (z.B. „Anweisung: y := 1 · Nein-Zweig“) und wird
von Screenreadern vorgelesen. Nach dem Einfügen öffnet sich der Bearbeiten-Dialog; nach dem Schließen ist der
Fokus wieder im Diagramm. Mit der Maus: Shift+Klick auf einen Einfüge-Knopf der Editor-Werkzeugleiste fügt davor
ein; in der Werkzeug-Ansicht legen die Knöpfe *Danach / Davor einfügen* die Position fest.

Im Bearbeiten-Dialog lässt sich der **Elementtyp** wechseln (z.B. Kopfschleife → Fußschleife, Verzweigung →
Fallauswahl, Anweisung → Aufruf). Enthaltene Elemente bleiben erhalten: Sie wandern in den ersten Block des neuen
Elements oder stehen – bei einer einfachen Anweisung – direkt dahinter. Bedingungen werden passend umgeformt
(`while x > 0` → `until x <= 0`).

Im Bearbeiten-Dialog schlägt die Autovervollständigung passend zur Stelle vor (↑/↓ auswählen,
**Tab**/**Enter** übernehmen, Esc schließt, Strg+Leertaste öffnet von Hand):

| Stelle | Vorschläge |
|---|---|
| Zeilenanfang einer Anweisung | `INPUT`, `OUTPUT`, `var`, `const`, `type`, dann Variablen, Unterprogramme und Prozeduren (`inc`, `forward` …) |
| nach `var name:` | nur Datentypen (`int`, `double`, `string` …) – Liste öffnet sich von selbst |
| nach `var ` | nichts (neuer Name) |
| nach `INPUT` | nur Variablen |
| in Ausdrücken (`x := …`, `OUTPUT …`, Bedingungen) | Variablen, Unterprogramme, Funktionen wie `int()`, `sqrt()`, `true`/`false`/`not` |
| nach einem Wert + Leerzeichen | `and`, `or`, `mod` – in Zählschleifen `to`/`by`, bei `foreach` `in` |
| Sprung / Zählschleife / Fußschleife | `leave`, `return`, `exit` … / `for`, `foreach` / `until` |

## Grenzen
Es ist kein vollständiger Compiler: Klassen, Zeiger und Bibliotheksaufrufe werden vereinfacht oder unverändert
übernommen; von mehreren `catch`-Zweigen wird nur der erste übernommen. Variablentypen werden – wo nötig – geschätzt.
String-Verkettung mit `+` lässt sich nicht nach C übersetzen.
Bei Kotlin und Rust werden Klassen, `impl`-Blöcke, Lambdas/Closures und Ownership vereinfacht; im erzeugten
Rust-Code werden Zeichenketten und Arrays bei Funktionsaufrufen mit `.clone()` übergeben.

Parallelverarbeitung im erzeugten Code:
- **Rust** lässt nicht zu, dass ein Zweig eine Variable ändert, die ein anderer Zweig verwendet – der Compiler
  meldet dann einen Fehler (das wäre ein Datenwettlauf).
- **Pascal** erzeugt Threads nur im Hauptprogramm; in Unterprogrammen laufen die Zweige nacheinander, weil
  Thread-Funktionen nur globale Variablen sehen. Felder brauchen Free Pascal ab 3.2.
- **JavaScript** kennt keine Threads mit gemeinsamen Variablen, die Zweige laufen nacheinander. Für `INPUT`
  braucht der erzeugte Code das Paket `prompt-sync` (`npm install prompt-sync`), das in einem Terminal laufen muss.
- **C** braucht `-fopenmp`, sonst laufen die Zweige nacheinander.

## Entwicklung
`node test/sprachtest.js` führt `test/samples/gesamttest.nsd` mit dem eingebauten Interpreter aus, erzeugt Code für
alle Zielsprachen, übersetzt und startet ihn und vergleicht die Ausgaben. Sprachen ohne installierten Compiler
werden übersprungen; ein anderes Struktogramm und die Eingabe lassen sich angeben
(`node test/sprachtest.js datei.nsd --input 3 python rust`).

## Lizenz
Diese Extension steht unter der MIT-Lizenz. Structorizer (© Bob Fisch, Kay Gürtzig u.a.) ist ein
eigenständiges Programm unter GPL-3.0 (https://github.com/fesch/Structorizer.Desktop); es wird nicht
mitgeliefert, sondern nur auf Wunsch heruntergeladen und als separates Programm aufgerufen.
Das Symbol „Neues Struktogramm“ (`media/struktograf-icons.woff`) übernimmt den Kreis mit Plus aus den
[Codicons](https://github.com/microsoft/vscode-codicons) von Microsoft (CC BY 4.0); erzeugt mit `docs/build-icon-font.py`.
