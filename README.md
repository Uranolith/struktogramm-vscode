# Struktograf – Nassi-Shneiderman-Struktogramme für VS Code

Struktogramm-Editor im Stil von **Structorizer**, direkt in VS Code.

> **Preview.** Die Extension ist im
> [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Uranolith.struktogramm)
> veröffentlicht, ist aber noch experimentell und in aktiver Entwicklung. Die Änderungen stehen im
> [CHANGELOG](CHANGELOG.md).

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
- **Struktogramm → Code**: Python, Java, C, C++, C#, JavaScript (Node.js), Kotlin, Rust.
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
    Turtleizer-Zeichnung. Eingaben werden wie in normalem Code gelesen: Kommazahlen mit Punkt (`3.5`); `3,5` für eine
    Kommazahl meldet „keine gültige Zahl – meintest du 3.5?“, und nur vollständige Zahlen gelten (`3a` ist keine Zahl).
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
- **Prüfungen beim Bearbeiten**: Jedes Element zeigt oben rechts eine Marke, wenn etwas nicht stimmt; beim
  Darüberfahren zeigt ein Hover-Fenster die Meldung gegliedert (Aussage, Vorschlag, Begründung), die Ansicht
  *Probleme* listet alle.
  - **Fehler** (rot, „!“) – funktioniert so nicht: Syntaxfehler, Variable ohne Wert, unbekannte Funktion, falsche Zahl
    von Argumenten, `leave` außerhalb einer Schleife, Division durch 0, unlesbarer Schleifenkopf, leere Bedingung,
    Zuweisung mit `=` statt `:=` bzw. `<-` (`=` ist der Vergleich – die Formatierung ändert es bewusst nicht),
    Zuweisung in einer Bedingung (`if x := 5` – in Bedingungen vergleicht man mit `=`).
  - **Code wird nur aus einem fehlerfreien Struktogramm erzeugt**: Hat die Datei einen Fehler, nennt *Code erzeugen*
    die Anzahl und den ersten Fehler (mit *Probleme anzeigen*). Das gilt je Struktogramm-Datei – Fehler in anderen
    Dateien spielen keine Rolle. Mit dem Struktogramm verbundener Code wird bei Fehlern nicht nachgeführt.
  - **Hinweise** (gelb, „i“, jeweils mit Begründung) – Good Practice und Konventionen: Variable, Parameter oder
    Rückgabewert ohne Typ (mit Vorschlag, z. B. `var summe: int`), Eingabe ohne Aufforderungstext, Kommazahlen mit `=`
    verglichen, Fallauswahl über eine Bedingung, mehrere Anweisungen in einem Block, mögliche Endlosschleife, Wert wird
    nie verwendet, nicht erreichbare Elemente, Variable mal Text, mal Zahl. Ein Hinweis erscheint an jeder Stelle, an
    der er zutrifft: „ohne Typ“ etwa an jeder Stelle, an der eine Variable auf ihrem Weg zum ersten Mal einen Wert
    bekommt (in jedem Fall einer Fallauswahl), aber nicht an späteren Zuweisungen im selben Block.
  - In *Probleme* trägt jede Meldung den Link **Element zeigen**: Er holt das Struktogramm nach vorn (bzw. öffnet es)
    und markiert das Element. Ein Klick auf die Zeile selbst öffnet nur das Struktogramm – die Fundstelle gibt
    VS Code an eigene Editoren nicht weiter.
  - **F8 / Umschalt+F8** springt wie in VS Code zum nächsten bzw. vorherigen Element mit einer Meldung und zeigt sie
    darunter an.
  - Beispiele: `test/samples/checks/errors.nsd` und `hints.nsd` (absichtlich fehlerhaft; der Kommentar jedes
    Elements – sichtbar beim Bearbeiten – nennt die erwartete Meldung).
  - Hinweise in vier Gruppen, je einzeln abschaltbar (`struktogramm.hints.*`, Standard: alle an); die Gruppe steht
    im Hover-Fenster und als Quelle in *Probleme*:
    - **Good Practice** – Variable, Konstante, Parameter oder Rückgabewert ohne Typ (auch `var s := "Hallo"` →
      `var s: string := "Hallo"`), Unterprogramm ohne Rückgabe ohne `: void`, Eingabe ohne Aufforderungstext,
      Variable nur in einem Zweig deklariert, aber in einem anderen bzw. danach verwendet (Vorschlag: auch in diesem
      Zweig deklarieren bzw. vor der Fallauswahl/Verzweigung/Schleife)
    - **Konventionen** – Fallauswahl über eine Bedingung, Bedingungen als Fallmarken, mehrere Anweisungen in einem
      Block, leerer Schleifenrumpf, leerer Block, Struktogramm ohne Namen. Das sind übliche Konventionen aus Lehre
      und Praxis: Die DIN 66261 legt nur die Sinnbilder fest, keine Regeln für ihren Gebrauch.
    - **Missverständlich** – „sonst“-Zweig mit Bedingung beschriftet, Variable mal Text mal Zahl, Kommazahlen mit `=`
      verglichen, Wert wird nie verwendet
    - **Mögliche Logikfehler** – Endlosschleife ohne Ausstieg, Schleifenbedingung ändert sich nie, nicht erreichbares
      Element
  - Einstellung `struktogramm.checks`: Fehler und Hinweise (Standard), nur Fehler oder keine Prüfungen. Fehler
    erscheinen immer, solange die Prüfungen an sind.
- **Original-Structorizer** (optional, benötigt Java 11+): wird beim ersten Gebrauch von GitHub
  heruntergeladen (Befehl *Structorizer herunterladen oder einrichten...*).
  - *Code aus Struktogramm erzeugen...* bietet zusätzlich 16 Structorizer-Generatoren an (u.a. PHP, Perl, BASIC,
    Bash, Oberon, LaTeX/StrucTeX).
  - COBOL- und Processing-Dateien werden mit dem Structorizer-Parser eingelesen;
    für C/Java gibt es *Struktogramm aus Code erzeugen (Structorizer-Parser)*.
  - *Im Structorizer öffnen* startet die Structorizer-Oberfläche mit dem Diagramm.
- **Sprache**: Deutsch oder Englisch (Einstellung `struktogramm.language`, Standard: wie die VS-Code-Oberfläche) –
  gilt für Editor, Werkzeuge, Ausführung, Prüfungen und Kommentare im erzeugten Code und wirkt sofort. Die Texte der
  VS-Code-Einstellungen und Befehlsnamen folgen immer der VS-Code-Oberfläche.
- **Einstellungen** – am schnellsten über das Zahnrad oben rechts im Struktogramm-Editor oder über die
  Befehlspalette (Strg+Umschalt+P) mit *Struktograf: Settings* (bzw. *Struktograf: Einstellungen*); beides öffnet die
  Einstellungen von VS Code gefiltert auf Struktograf. Sie stehen in fünf Abschnitten: **Allgemein** (Sprache, Ort
  der Werkzeuge und der Ausführung), **Darstellung** (Farbschema, Hervorhebung, Operatoren, Anzeige der Zuweisung,
  Zweig-Beschriftungen), **Prüfungen** (Prüfungen und Hinweisgruppen), **Code erzeugen und einlesen**,
  **Structorizer**.
- **Export** als SVG, PNG, JSON, XML, KI-kompakter Pseudocode und einzelne Structorizer-Dateien (siehe [Export](#export)).
- **Structorizer-kompatibel**: liest und schreibt `.nsd` (XML) in Structorizer-Schreibweise. Eine Datei mit
  einem Diagramm öffnet der Structorizer direkt. Dateien mit mehreren Diagrammen (z.B. nach einem
  Code-Import mit Funktionen) kann der Structorizer nicht lesen. Teile sie mit *Diagramme einzeln als
  Structorizer-Dateien speichern* auf.

## Schreibweise im Struktogramm
Die Diagramme verwenden die Schreibweise des Original-Structorizers: Zuweisung `:=`, Vergleich `=` und `<>`.
Eine `.nsd`-Datei mit einem Diagramm lässt sich daher unverändert im Structorizer öffnen.

Zuweisungen schreibt man mit `:=` oder mit dem Pfeil `<-` – beide sind gültig und bleiben, wie sie geschrieben sind.
Wie sie *angezeigt* werden, legt die Einstellung `struktogramm.assignmentOperator` fest: wie geschrieben (Standard),
immer `:=` oder immer `<-` (mit *Operatoren hübsch darstellen* als `←`). Das betrifft nur die Anzeige und den Export
als Bild, nicht die Datei.
`=` ist im Struktogramm immer der Vergleich – auch im Interpreter und im erzeugten Code: `x = 5` weist nichts zu
(erzeugt wird `x == 5`), `var x: int = 5` und `for i = 1 to 10` sind ungültig. Die Prüfung meldet solche Zeilen als
Fehler mit der richtigen Schreibweise; umgestellt wird nichts. Beim Speichern umgestellt werden nur `==` zu `=` und
`!=` zu `<>`. Code-Importe erzeugen von sich aus `:=`.

Beim Übernehmen eines Blocks im Bearbeiten-Dialog wird der Text außerdem einheitlich formatiert – wie die Vorlage
im Dialog: `INPUT` und `OUTPUT` groß, alle anderen Schlüsselwörter klein (`var`, `return`, `for … to … by`, `and`,
`true` …), Deklarationen immer als `var name: typ` – auch aus `int x = 5`, `x: int` oder `var x as int` –, mehrere
Namen als `var a, b: int := 0` (eingebaute Typen klein), Rechnungen und Vergleiche mit Leerzeichen um die Operatoren
(`a+b<=c` → `a + b <= c`, ein Vorzeichen wie in `x := -1` bleibt am Wert), nach Kommas ein Leerzeichen, Signaturen
als `fib(n: int): int`. Ob ein Wort ein Schlüsselwort ist, ergibt sich aus dem Zusammenhang – eine Variable namens
`Output` oder `by` bleibt, wie sie ist; Texte in Anführungszeichen bleiben unverändert.

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
`switch (true) { case true when … }` (C#), `when { … }` (Kotlin) bzw. `match true { _ if … }` (Rust); in Java, C, C++
und Python, wo `case`-Marken Konstanten sein müssen, zu einer `if / else if`-Kette. Turtle-Befehle werden für
Python in das Modul `turtle` übersetzt; die Datei-API (`fileOpen` … `fileWriteLine`) bekommt in jeder Sprache eine
kleine Hilfsschicht mit demselben Verhalten wie im Interpreter (Dateinummern, Fehlercodes `-2`/`-3`/`-1`, Lesen nach
Wort, Zeichen oder Zeile).
Textvergleiche (`name < "m"`, `a = b`, auch in Fallauswahl und Schleifenbedingungen) werden je Sprache passend
übersetzt – Java `compareTo`/`equals`, C `strcmp`, C# `string.CompareOrdinal`, Rust `as_str()`, in C und C++ wird eine
Fallauswahl über einen Text zur `if / else if`-Kette; verglichen wird wie im Interpreter zeichenweise.

**Parallelverarbeitung** wird zu echten Threads: Python `threading`, Java je Zweig eine Thread-Klasse,
C# `Parallel.Invoke`, C++ `std::thread`, C OpenMP (`#pragma omp parallel sections`, mit `-fopenmp` übersetzen),
Kotlin `thread { }`, Rust `std::thread::scope`. Das Programm wartet, bis alle Zweige
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
Textverkettung mit `+` wird je Sprache umgewandelt (Python f-String, C++ `to_string`, Rust `format!`, C über kleine
Hilfsfunktionen mit neuem Speicher je Verkettung). Wird eine Variable von der Ganzzahl zur Kommazahl, speichert der
Code sie als Kommazahl und wandelt sie um, solange sie eine Ganzzahl ist. Ist eine Variable mal Text, mal Zahl, lässt
sich das in typisierten Sprachen nicht nachbilden: Die Stelle wird im Code mit ACHTUNG markiert, und *Code erzeugen*
warnt. Kommazahlen gibt der erzeugte Code wie der Interpreter aus (kürzeste exakte Form, `80.0`, Exponent erst
unter 0.000001 bzw. ab 1e21: `1e-7`); in Sprachen, deren eigene Ausgabe davon abweicht, über eine kleine
Hilfsfunktion am Anfang des Programms.
Bei Kotlin und Rust werden Klassen, `impl`-Blöcke, Lambdas/Closures und Ownership vereinfacht; im erzeugten
Rust-Code werden Arrays als Referenz übergeben (`&mut`, wenn das Unterprogramm sie verändert, sonst `&`),
Zeichenketten als Kopie (`.clone()`).

Damit Interpreter und erzeugter Code dasselbe ausgeben, gilt:
- **Datentypen bestimmt der Anwender.** Ein angegebener Typ (`var x: long`) wird übernommen; ohne Angabe sind
  Ganzzahlen `int`. Ein Überlauf (Werte über 2147483647) ist Sache des Programms – wird eine `int`-Variable mit einer
  Multiplikation berechnet, weist ein Kommentar im Code auf den größeren Typ hin. Bei so großen Werten kann der
  Interpreter (rechnet exakt bis 2^53) anders rechnen als `int`-Code.
- **Der Interpreter folgt der Typableitung des Generators.** Ein Unterprogramm, das mit Ganzzahl und Kommazahl
  aufgerufen wird (`halb(7)`, `halb(3.0)`), rechnet überall mit Kommazahl. Eine Eingabe wird in den abgeleiteten Typ
  umgewandelt: `2.5` für eine Ganzzahl-Variable wird zu `2`, `5` für eine Kommazahl-Variable zu `5.0`, Text wie `abc`
  ist ein Fehler (in `try` abfangbar).
- **Namen**, die in der Zielsprache reserviert sind oder die der erzeugte Code selbst benutzt (`class`, `new`, in
  Python `len`, `str` …), bekommen einen Unterstrich (`class_`).
- **Laufzeitfehler in `try`**: Division durch 0 ist in allen Sprachen abfangbar. Ein Index außerhalb eines Arrays
  ist es in C, C++ und JavaScript nicht. Der Text der Fehlermeldung im `catch` unterscheidet sich je Sprache.
- **C**: Texte liegen in eigenem Speicher (ohne Längengrenze, wird nicht freigegeben); Längen und Positionen zählen
  Zeichen (UTF-8). Arrays tragen ihre Länge mit (`int name_len`), eine Funktion mit Array-Ergebnis gibt sie über
  `int* _len` zurück. **C++** verwendet für Arrays `std::vector`.
- Methoden wie `s.length()`, `s.substring(0, 2)` oder `s.toUpperCase()` werden auf die Struktogramm-Funktionen
  abgebildet. Arrays, die wachsen (`push`, `append`, `pop`), werden nicht übersetzt.
- **`fileRead`** liest in eine Variable je nach deren Typ eine ganze Zahl, eine Kommazahl oder Text (ohne Typangabe
  wie bei `INPUT` aus der Verwendung abgeleitet). Mitten in einem Ausdruck liefert es in den Sprachen mit festen Typen
  Text (Hinweis im Code); für Zahlen dann `fileReadInt` bzw. `fileReadDouble` verwenden.

Parallelverarbeitung im erzeugten Code:
- **Rust** lässt nicht zu, dass ein Zweig eine Variable ändert, die ein anderer Zweig verwendet – der Compiler
  meldet dann einen Fehler (das wäre ein Datenwettlauf).
- **JavaScript** kennt keine Threads mit gemeinsamen Variablen, die Zweige laufen nacheinander. `INPUT` liest über
  eine kleine eigene Funktion zeilenweise aus dem Terminal (UTF-8, ohne Zusatzpaket).
- **C** braucht `-fopenmp`, sonst laufen die Zweige nacheinander.

## Entwicklung
- **Aufgabentest** – `npm test`, `test\tasktest.cmd` oder in VS Code *Terminal → Task ausführen… → Aufgabentest*:
  übersetzt alle Struktogramme in den Themenordnern unter `test/samples` in alle Zielsprachen, baut und startet sie
  mit den echten Compilern, vergleicht die Ausgaben mit dem eingebauten Interpreter und schreibt das Ergebnis
  (O = erfolgreich, X = nicht erfolgreich, K = bekannter Fehler, B = bekannter Fehler behoben, – = Compiler fehlt)
  nach `test/out/tasktest.xlsx`. Bricht der Interpreter mit einem Laufzeitfehler ab, gilt ein Testfall als erfolgreich,
  wenn auch das Programm mit einem Fehler endet und bis dahin dasselbe ausgibt. Vorher prüft `test/builtins.js`, ob
  jede Funktion und Methode des Interpreters in jede Sprache übersetzt wird (`npm run test:builtins` zeigt alle
  Lücken). Plan, Entscheidungen und Stand: `docs/CODEGEN-PLAN.md`. Der erzeugte Code liegt
  danach in `test/samples/codefiles` (wird bei jedem Lauf neu erzeugt). Einzelne Sprachen oder Ordner:
  `node test/tasktest.js java edge_cases`.
  - Die Kommentare im erzeugten Code stehen in der Sprache der Erweiterung: Einstellung `struktogramm.language` aus
    den Arbeitsbereich- bzw. Benutzereinstellungen von VS Code, bei *Automatisch* die Sprache der VS-Code-Oberfläche.
    Die verwendete Sprache steht am Anfang der Ausgabe; vorgeben mit `--sprache de` bzw. `--sprache en`.
  - `test/samples/edge_cases`: Grenzfälle der Code-Erzeugung (Textverkettung, große Zahlen, Runden, Schleifen,
    Typwechsel, Umwandlungen, Kommazahl-Grenzen …); alle laufen in allen acht Sprachen.
  - `test/samples/checks`: Beispiele für die Prüfungen im Editor (absichtlich fehlerhaft, vom Aufgabentest
    übersprungen).
  - Weitere Themenordner (`control_flow`, `try_catch`, `arrays`, `functions`, `types`, `expressions`, `builtins`,
    `identifiers`, `records`) prüfen gezielt einzelne Bereiche der Codeerzeugung.
  - Testfälle je Ordner in `inputs.json`: je Struktogramm eine Liste von Eingabefolgen (eine Zeile je `INPUT`);
    `"_tasktest": false` schließt einen Ordner aus. Bekannte Fehler stehen unter `"_known"`
    (`{ "datei.nsd": { "c": "4.2", "*": "6.1" } }` – Sprache oder `*` und der Schritt im Plan, der sie behebt).
  - Auf GitHub läuft der Aufgabentest bei jedem Push und Pull Request je Sprache (`.github/workflows/test.yml`).
  - Das Excel-Protokoll braucht Python mit `openpyxl` (`pip install openpyxl`).
- **Veröffentlichen** – ohne gespeichertes Zugangstoken über *OIDC Trusted Publishing*: Wird auf GitHub ein Release mit
  der `.vsix` veröffentlicht, lädt der Workflow `.github/workflows/publish.yml` genau diese Datei hoch
  (`vsce publish --oidc`). Für ein bestehendes Release lässt er sich auch von Hand starten (*Actions → Marketplace
  veröffentlichen → Run workflow*, Tag z. B. `v1.0.2`). Voraussetzung ist im Marketplace unter *Trusted Publishing*
  eine Regel für dieses Repository, den Workflow `publish.yml` und die Umgebung `marketplace`.
- **Sprachtest** – `node test/langtest.js datei.nsd --input 3 python rust`: ein einzelnes Struktogramm mit einer
  Eingabe in alle (oder die genannten) Sprachen übersetzen, ausführen und mit dem Interpreter vergleichen; ohne
  Angabe `test/samples/gesamttest.nsd`. Sprachen ohne installierten Compiler werden übersprungen.

## Lizenz
Diese Extension steht unter der MIT-Lizenz. Structorizer (© Bob Fisch, Kay Gürtzig u.a.) ist ein
eigenständiges Programm unter GPL-3.0 (https://github.com/fesch/Structorizer.Desktop); es wird nicht
mitgeliefert, sondern nur auf Wunsch heruntergeladen und als separates Programm aufgerufen.
Das Symbol „Neues Struktogramm“ (`media/struktograf-icons.woff`) übernimmt den Kreis mit Plus aus den
[Codicons](https://github.com/microsoft/vscode-codicons) von Microsoft (CC BY 4.0); erzeugt mit `docs/build-icon-font.py`.
