# Struktogramm – Code ⇄ Nassi-Shneiderman (VS Code)

Struktogramm-Editor im Stil von **Structorizer**, direkt in VS Code.

## Funktionen
- **Code → Struktogramm**: Python, Java, C, C++, C#, JavaScript, TypeScript
  (Rechtsklick im Editor → *Struktogramm aus Code erzeugen*; mit Markierung nur der markierte Teil).
  Jede Funktion wird ein eigenes Diagramm, `main` bzw. Code auf oberster Ebene wird das Hauptprogramm.
- **Live-Vorschau**: Symbol oben rechts im Code-Editor – das Struktogramm aktualisiert sich beim Tippen.
- **Grafischer Editor** für `.nsd`-Dateien: Elemente einfügen, bearbeiten (Doppelklick), ziehen,
  kopieren/einfügen, Kontextmenü, Farben, Kommentare, Rückgängig.
- **Struktogramm → Code**: Python, Java, C, C++, C#, JavaScript (Node.js), Pascal.
- **Ausführen** (wie der Structorizer-Executor): ▶ Ausführen, ⏭ Einzelschritt, ⏸ Pause, ⏹ Stopp,
  Tempo einstellbar, Haltepunkte (F9 oder Rechtsklick), Ein-/Ausgabe in der Konsole unten,
  Variablen und Aufrufstapel daneben, Unterprogramme und Rekursion. Fehler werden am Element rot markiert.
  Funktioniert auch in der Live-Vorschau von Quelltext.
- **Original-Structorizer** (optional, benötigt Java 11+): wird beim ersten Gebrauch von GitHub
  heruntergeladen (Befehl *Structorizer herunterladen / einrichten*).
  - *Code erzeugen …* bietet zusätzlich alle 18 Structorizer-Generatoren an (u.a. PHP, Perl, BASIC,
    Bash, Oberon, Delphi, LaTeX/StrucTeX).
  - Pascal/Delphi-, COBOL- und Processing-Dateien werden mit dem Structorizer-Parser eingelesen;
    für C/Java gibt es *Struktogramm aus Code erzeugen (Structorizer-Parser)*.
  - *Im Original-Structorizer öffnen* startet die Structorizer-Oberfläche mit dem Diagramm.
- **Export** als SVG oder PNG.
- **Structorizer-kompatibel**: liest und schreibt `.nsd` (XML). Dateien mit mehreren Diagrammen
  können per *Diagramme einzeln als Structorizer-Dateien speichern* aufgeteilt werden.

## Schreibweise im Struktogramm
Zuweisungen werden mit `=` geschrieben, Vergleiche mit `==` und `!=`. Für den Original-Structorizer
wird automatisch in dessen Schreibweise (`<-`) umgewandelt.
| Element | Beispiel |
|---|---|
| Zuweisung | `x = 5` (alte Structorizer-Schreibweise `x <- 5` wird ebenfalls verstanden) |
| Deklaration | `int x = 0` · `var x: int` |
| Eingabe / Ausgabe | `INPUT "Zahl: ", x` · `OUTPUT "Summe: ", s` |
| Bedingung | `x > 3 and y != 0` · Vergleich `x == 0` |
| Zählschleife | `for i = 1 to 10 by 2` · `foreach x in liste` |
| Kopf-/Fußschleife | `while x > 0` · `until x == 0` |
| Fallauswahl | 1. Zeile Ausdruck, dann je Fall eine Zeile, letzte Zeile `default` (oder `%`) |
| Sprung | `leave` · `return x` · `exit 0` |

Schlüsselwörter (blau, fett), Funktionsaufrufe (dunkelgelb, fett), Datentypen (petrol), Zeichenketten (rot),
Operatoren (lila, fett: Zuweisung `=`, Vergleiche `==` `!=` `<` `>` `≤` `≥`, Rechnen `+ - * / %` `div` `mod`) werden im Diagramm farbig
dargestellt; abschalten mit der Einstellung `struktogramm.highlightKeywords`.

## Hell / Dunkel
Das Struktogramm passt sich dem VS-Code-Farbschema an: bei einem dunklen Theme wird es dunkel
dargestellt, sonst hell (Einstellung `struktogramm.theme`: `auto`, `light`, `dark`). Elementfarben
werden im dunklen Schema als dunkle Variante desselben Farbtons gezeigt. Beim Export als SVG oder PNG
wird gefragt, ob das Bild hell oder dunkel werden soll (`struktogramm.exportTheme`: `ask`, `editor`,
`light`, `dark`).

## Export
**Exportieren …** (Werkzeugleiste, Titelleiste, Explorer-Kontextmenü) bietet:

| Format | Zweck |
|---|---|
| SVG / PNG | Bild, hell oder dunkel |
| JSON | vollständige Struktur (`diagrams[].body[]` mit `type`, `text`, `condition`, `then`/`else`, `body`, `branches` …) |
| XML | dieselbe Struktur als einfaches XML (`<if><condition/><then/><else/></if>` …) |
| KI-kompakt | token-sparender Pseudocode für KI-Agents – in die Zwischenablage (Knopf **KI ⧉**) oder als `.ki.txt` |
| Structorizer-Dateien | je Diagramm eine `.nsd` für den Original-Structorizer |

KI-kompakt nutzt Einrückung mit einem Leerzeichen statt Klammern/Tags und ist etwa 6–8× kürzer als JSON:
```
PROGRAM rechner
INPUT "Zahl: ", zahl
for i = 1 to zahl
 s = s + i
if ist_prim(zahl)
 OUTPUT zahl, " ist prim"
else
 OUTPUT "nein"
FUNCTION summe(a: int; b: int): int # Addiert zwei Zahlen.
return a + b
```

## Tastatur im Editor
**F5** ausführen / fortsetzen · **F10** (oder F11) Einzelschritt · **F6** anhalten · **Umschalt+F5** beenden ·
**F9** Haltepunkt. Im Explorer: Rechtsklick auf eine `.nsd` → *Struktogramm ausführen / fortsetzen*.

Enter/F2 bearbeiten · Entf löschen · Strg+↑/↓ verschieben · Pfeiltasten navigieren ·
Strg+C/X/V · Strg+Mausrad Zoom · Shift+Klick auf Einfüge-Knopf fügt davor ein.

Im Bearbeiten-Dialog schlägt die Autovervollständigung passend zur Stelle vor (↑/↓ auswählen,
**Tab**/**Enter** übernehmen, Esc schließt, Strg+Leertaste öffnet von Hand):

| Stelle | Vorschläge |
|---|---|
| Zeilenanfang einer Anweisung | `INPUT`, `OUTPUT`, `var`, `const`, dann Variablen und Unterprogramme |
| nach `var name:` | nur Datentypen (`int`, `double`, `string` …) – Liste öffnet sich von selbst |
| nach `var ` | nichts (neuer Name) |
| nach `INPUT` | nur Variablen |
| in Ausdrücken (`x = …`, `OUTPUT …`, Bedingungen) | Variablen, Unterprogramme, Funktionen wie `int()`, `sqrt()`, `true`/`false`/`not` |
| nach einem Wert + Leerzeichen | `and`, `or`, `div`, `mod` – in Zählschleifen `to`/`by`, bei `foreach` `in` |
| Sprung / Zählschleife / Fußschleife | `leave`, `return`, `exit` … / `for`, `foreach` / `until` |

## Grenzen
Es ist kein vollständiger Compiler: Klassen, Ausnahmen (`try/catch`), Zeiger und Bibliotheksaufrufe
werden vereinfacht oder unverändert übernommen. Variablentypen werden – wo nötig – geschätzt.
String-Verkettung mit `+` lässt sich nicht nach C übersetzen.

## Lizenz
Diese Extension steht unter der MIT-Lizenz. Structorizer (© Bob Fisch, Kay Gürtzig u.a.) ist ein
eigenständiges Programm unter GPL-3.0 (https://github.com/fesch/Structorizer.Desktop); es wird nicht
mitgeliefert, sondern nur auf Wunsch heruntergeladen und als separates Programm aufgerufen.
