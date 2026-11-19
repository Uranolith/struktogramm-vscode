# Struktogramm-Extension weitergeben und veröffentlichen

Diese Anleitung beschreibt drei Wege, von einfach bis öffentlich:

1. [Die `.vsix`-Datei direkt weitergeben](#1-vsix-datei-direkt-weitergeben) – sofort möglich, ohne Konto.
2. [Über GitHub Releases verteilen](#2-über-github-releases-verteilen) – ein fester Download-Link.
3. [Im VS Code Marketplace veröffentlichen](#3-im-vs-code-marketplace-veröffentlichen) – auffindbar in VS Code, mit automatischen Updates.
   Optional zusätzlich auf [Open VSX](#4-zusätzlich-auf-open-vsx-veröffentlichen-optional) (VSCodium, Cursor, Gitpod …).

**Stand des Projekts (Version 0.8.1, Anzeigename „Struktograf“):**

| Punkt | Stand | Für den Marketplace |
|---|---|---|
| `publisher` in `package.json` | `Uranolith` | ok – Publisher im Marketplace-Portal mit genau dieser ID anlegen |
| Icon | `media/icon.png` (256×256, Quelle `docs/icon.svg`) | ok |
| Lizenz | MIT, Datei `LICENSE` vorhanden | ok |
| `repository`, `bugs`, `homepage` | eingetragen | ok |
| README | vorhanden | ok – wird die Seite im Marketplace |
| GitHub-Repository | **privat** | sollte öffentlich sein (Links aus dem Marketplace) |
| Node.js, `vsce`, `ovsx` | installiert (Node.js LTS per winget, Werkzeuge mit `npm install -g @vscode/vsce ovsx`) | ok |
| Paket bauen | `vsce package` (prüft das Paket, keine Warnungen) | ok – `build-vsix.py` bleibt als Notlösung ohne Node.js |

---

## 1. `.vsix`-Datei direkt weitergeben

Die Datei `struktogramm-<version>.vsix` ist die komplette Extension. Sie lässt sich wie jede andere Datei
weitergeben (E-Mail, USB-Stick, Teams, Netzlaufwerk …).

**Paket bauen** (im Projektordner, in PowerShell oder der Eingabeaufforderung):

```
vsce package
```

Ohne Node.js geht es auch mit `python build-vsix.py`.

Es entsteht `struktogramm-<version>.vsix` im Projektordner.

**Installieren beim Empfänger** – einer dieser Wege:

- In VS Code: Ansicht **Erweiterungen** (Strg+Umschalt+X) → Menü **⋯** oben rechts → **Aus VSIX installieren …**
  → Datei auswählen.
- Im Terminal:
  ```
  code --install-extension struktogramm-0.8.1.vsix
  ```

Danach VS Code neu laden, falls es dazu auffordert.

**Gut zu wissen**

- Voraussetzung: VS Code 1.80 oder neuer. Java 11+ nur für die optionalen Original-Structorizer-Funktionen.
- **Keine automatischen Updates:** Für eine neue Version die neue `.vsix` genauso installieren; sie ersetzt die alte.
- Deinstallieren: Erweiterungen → *Struktogramm* → **Deinstallieren**, oder
  `code --uninstall-extension Uranolith.struktogramm`.
- VS Code zeigt bei Erweiterungen aus einer `.vsix` keine Herkunftsprüfung an. Gib die Datei nur über Wege weiter,
  denen der Empfänger vertraut.

---

## 2. Über GitHub Releases verteilen

Für jede Version gibt es bereits ein Release mit der `.vsix`, z.B.
<https://github.com/Uranolith/struktogramm-vscode/releases/tag/v0.8.1>.

**Das Repository ist zurzeit privat.** Dann können nur Personen mit Zugriff die Datei laden. Zwei Möglichkeiten:

- **Einzelne Personen einladen:** GitHub → Repository → **Settings → Collaborators → Add people**.
- **Öffentlich machen** (für alle sichtbar, auch der Quellcode):
  ```
  gh repo edit Uranolith/struktogramm-vscode --visibility public --accept-visibility-change-consequences
  ```
  oder im Browser: **Settings → General → Danger Zone → Change repository visibility**.

**Neues Release anlegen** (nach dem Erhöhen der Version in `package.json`, Commit und Push):

```
python build-vsix.py
gh release create v0.8.2 struktogramm-0.8.2.vsix --title "Struktogramm 0.8.2" --notes "Was ist neu …"
```

Empfänger laden die `.vsix` von der Release-Seite und installieren sie wie in Abschnitt 1.

---

## 3. Im VS Code Marketplace veröffentlichen

Der Marketplace ist die Erweiterungsquelle, die VS Code standardmäßig durchsucht. Nach der Veröffentlichung findet man
die Extension direkt unter *Erweiterungen*, und VS Code aktualisiert sie automatisch.

> Microsoft passt das Anmeldeverfahren für das Veröffentlichen gelegentlich an. Prüfe bei Abweichungen die
> offizielle Anleitung: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>

### 3.1 Einmalige Vorbereitung

**a) Node.js installieren** (enthält `npm`/`npx`, damit laufen die offiziellen Werkzeuge):

```
winget install OpenJS.NodeJS.LTS
```

Danach ein neues Terminal öffnen und prüfen: `node --version`.

**b) Publisher anlegen**

1. <https://marketplace.visualstudio.com/manage> öffnen und mit einem Microsoft-Konto anmelden.
2. **Create publisher** wählen.
3. **ID** (z.B. `uranolith`) und Anzeigenamen festlegen. Die ID ist dauerhaft und Teil der Extension-Kennung
   (`<id>.struktogramm`).

**c) `package.json` anpassen**

```json
"publisher": "uranolith",
"icon": "media/icon.png",
"preview": true,
"galleryBanner": { "color": "#1e1e1e", "theme": "dark" },
```

- `publisher`: die ID aus Schritt b.
- `icon`: PNG mit mindestens 128×128 Pixeln. SVG ist als Extension-Icon nicht erlaubt.
- `preview: true`: zeigt im Marketplace das Etikett *Preview* – passend für den experimentellen Stand. Später entfernen.
- `galleryBanner`: Farbe des Kopfbereichs der Marketplace-Seite (optional).

Prüfe außerdem:

- **`displayName` muss im Marketplace eindeutig sein.** Ist „Struktogramm – Code ⇄ Nassi-Shneiderman“ schon vergeben,
  lehnt der Marketplace das Hochladen ab.
- Der Name *Structorizer* darf zur Beschreibung der Kompatibilität vorkommen (README, Stichwörter), aber nicht im
  Anzeigenamen – sonst sieht es aus, als wäre es das Original.
- Bilder in der README müssen über `https://` erreichbar sein (relative Pfade nur mit gesetztem `repository`).

**d) README und CHANGELOG**

- Die README wird zur Marketplace-Seite. Den Hinweis „Experimenteller Build … nicht im Marketplace“ und den Abschnitt
  zur `.vsix`-Installation entsprechend anpassen.
- Optional eine `CHANGELOG.md` anlegen; sie erscheint als eigener Reiter *Changelog*.

**e) Paket mit dem offiziellen Werkzeug bauen und prüfen**

```
npx @vscode/vsce package
```

`vsce` prüft das Paket und meldet fehlende oder fehlerhafte Angaben (Publisher, Icon, Lizenz, Links …). Die Dateiauswahl
steuert `.vscodeignore` (Tests, `docs/`, Build-Skript und alte `.vsix`-Dateien sind bereits ausgeschlossen).
Für den Marketplace dieses Paket statt `build-vsix.py` verwenden.

> Hinweis: Die Befehle `vsce` und `ovsx` in **PowerShell** oder der **Eingabeaufforderung** ausführen. In Git Bash
> scheitern sie an der Pfadumwandlung („Cannot find module …“).

### 3.2 Hochladen

**Variante A – im Browser (am einfachsten)**

1. <https://marketplace.visualstudio.com/manage> → dein Publisher.
2. **New extension → Visual Studio Code**.
3. Die mit `vsce package` erzeugte `.vsix` hochladen.

**Variante B – per Kommandozeile**

```
npx @vscode/vsce login <publisher-id>
npx @vscode/vsce publish
```

Für `login` brauchst du einen Zugangsschlüssel aus Azure DevOps (*Personal Access Token*):
<https://dev.azure.com> → Benutzereinstellungen → **Personal access tokens** → **New Token**,
Organisation **All accessible organizations**, Bereich **Marketplace → Manage**.
Je nach aktuellem Stand bietet Microsoft statt des Tokens auch eine Anmeldung über Microsoft Entra ID an
(siehe offizielle Anleitung oben).

Nach dem Hochladen prüft der Marketplace die Extension automatisch; meist ist sie nach wenigen Minuten unter
*Erweiterungen* zu finden.

### 3.3 Updates

1. Version in `package.json` erhöhen (z.B. `0.8.1` → `0.8.2`) – der Marketplace nimmt keine Version zweimal an.
2. Neu bauen und hochladen (Variante A) oder in einem Schritt:
   ```
   npx @vscode/vsce publish patch
   ```
   (`patch` erhöht 0.8.1 → 0.8.2; `minor` → 0.9.0; `major` → 1.0.0.)

Nutzer erhalten das Update automatisch.

### 3.4 Zurückziehen

Im Publisher-Portal bei der Extension **Unpublish** oder **Remove** wählen, oder `npx @vscode/vsce unpublish <publisher-id>.struktogramm`.
Bereits installierte Kopien bleiben bei den Nutzern installiert.

---

## 4. Zusätzlich auf Open VSX veröffentlichen (optional)

VSCodium, Cursor, Gitpod, Eclipse Theia und andere VS-Code-Abwandlungen nutzen statt des Microsoft-Marketplace die
freie Registry **Open VSX**.

1. Auf <https://open-vsx.org> mit GitHub anmelden.
2. In den Profileinstellungen das *Eclipse Foundation Open VSX Publisher Agreement* bestätigen
   (dafür ein Konto bei der Eclipse Foundation verknüpfen).
3. Unter **Settings → Access Tokens** einen Zugangsschlüssel erzeugen.
4. Einmalig den Namensraum (= Publisher-ID) anlegen:
   ```
   npx ovsx create-namespace <publisher-id> -p <token>
   ```
5. Dieselbe `.vsix` veröffentlichen:
   ```
   npx ovsx publish struktogramm-0.8.1.vsix -p <token>
   ```

Für Updates Schritt 5 mit der neuen Version wiederholen.

---

## 5. Rechtliches und Inhalt – kurz geprüft

- **Lizenz:** Die Extension steht unter MIT (`LICENSE`).
- **Structorizer** (© Bob Fisch, Kay Gürtzig u.a., GPL-3.0) wird **nicht mitgeliefert**. Er wird nur auf Wunsch
  heruntergeladen und als eigenständiges Programm aufgerufen; die README sagt das bereits. So bleibt die MIT-Lizenz der
  Extension unberührt.
- **Keine Telemetrie, keine Datenübertragung** außer dem optionalen Download von Structorizer von GitHub. Das kann auf
  der Marketplace-Seite so stehen bleiben.
- **Keine Geheimnisse ins Repository:** Zugangsschlüssel (Azure DevOps, Open VSX) nie in Dateien oder Commits
  speichern. Für automatisches Veröffentlichen per GitHub Actions als *Repository Secret* hinterlegen
  (z.B. `VSCE_PAT`, `OVSX_PAT`).

---

## Kurzfassung

| Ziel | Schritte |
|---|---|
| An Einzelne weitergeben | `python build-vsix.py` → `.vsix` schicken → *Aus VSIX installieren …* |
| Download-Link für viele | Repository öffentlich machen oder Personen einladen → `gh release create … .vsix` |
| Im VS Code Marketplace | Node.js installieren → Publisher anlegen → `publisher` und `icon` in `package.json` → `npx @vscode/vsce package` → `.vsix` im Portal hochladen |
| Für VSCodium/Cursor | Open-VSX-Konto und Token → `npx ovsx publish <datei>.vsix -p <token>` |
