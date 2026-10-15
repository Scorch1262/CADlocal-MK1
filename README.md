# BrowserCAD

**Programm-Icon:** Würfel mit Bohrung und Maßlinie (`build/icon-1024.png`, `build/icon.ico`, `build/icon.iconset/`) – eingebettet in die Windows-exe (Ressource), in die macOS-App (`icon.icns`) und als Favicon/Logo im Browser.

Version: siehe Datei `VERSION` (Basis) – das Release trägt `v<VERSION>.<Lauf-Nr.>`, z. B. `v1.1.7`. Die Version steht in der Konsole, oben im Programm und im Dialog Werkzeuge → Info.

Browserbasiertes CAD-Programm, das als **einzelne Programmdatei** (Windows `.exe`, macOS `.app`, optional Linux) eine Webseite im Netzwerk bereitstellt.
Die Bedienung und Oberfläche orientieren sich an **PTC Creo Parametric** (Ribbon, Modellbaum, Ebenen, Dashboard-Leiste unten, Datumebenen RIGHT/TOP/FRONT, Y-oben), im dunklen Dashboard-Look.

## Schnellstart

1. Im Repo unter **Actions** den Workflow *Build & Release* laufen lassen (läuft automatisch bei jedem Push auf `main`).
2. Unter **Releases** `BrowserCAD.exe` (Windows) oder `BrowserCAD-macOS.zip` (Mac) herunterladen.
3. Programm starten – der Browser öffnet sich auf `http://localhost:8080`.
4. Auf der Seite **„Nutzer anlegen“** (`/register`) Nutzernamen + Kennwort vergeben, danach unter `/login` anmelden.
5. Andere Rechner im Netzwerk: die in der Konsole angezeigte Adresse benutzen, z. B. `http://192.168.1.20:8080`.

> **macOS:** Die App ist nicht notarisiert. Beim ersten Start Rechtsklick → „Öffnen“. Sie öffnet ein **Terminal-Fenster**, in dem der Server läuft. Die Daten werden **neben der .app** gespeichert – die App deshalb in einen eigenen Ordner legen (z. B. `~/BrowserCAD/`), nicht nach `/Programme`.
> **Windows:** Die exe trägt das Programm-Icon und öffnet ein Konsolenfenster, in dem der Server läuft. SmartScreen → „Weitere Informationen“ → „Trotzdem ausführen“. Windows-Firewall-Abfrage für private Netzwerke bestätigen.

## Programm beenden

Das Programm lässt sich **nicht aus dem Browser heraus beenden** (es gibt dafür keinen Befehl im Server). Beenden geht nur auf dem Host: **Konsolen-/Terminal-Fenster schließen** (oder dort `Strg+C`). Das Schließen des Browserfensters beendet nichts – der Server läuft weiter.

## Nutzerverwaltung

* **Rollen:** Der erste angelegte Nutzer ist **Administrator**. Weitere Administratoren legt man in der Nutzerverwaltung fest. Gibt es (z. B. nach einem Update von einer älteren Version) keinen Administrator, wird der erste Nutzer in `users.json` automatisch einer.
* **Seite `/admin`** (nur Administratoren; im Programm oben „👥 Nutzerverwaltung“): Nutzerliste mit Rolle, Dateianzahl/-größe, letzter Anmeldung · Nutzer anlegen (Kennwort eintippen oder zufällig erzeugen lassen) · **Kennwort zurücksetzen** (eigenes oder zufällig erzeugtes; alle Sitzungen des Nutzers werden beendet) · Administratorrolle vergeben/entziehen (der letzte Administrator ist geschützt) · Nutzer löschen (Datenordner wird nach `daten/_geloescht/` verschoben oder auf Wunsch endgültig gelöscht).
* **Eigenes Kennwort ändern:** im Programm oben „🔑 Kennwort“ (altes Kennwort erforderlich).
* **Notfall auf dem Host** (z. B. Administrator-Kennwort vergessen), im Terminal neben der Programmdatei:
  ```
  BrowserCAD --reset-password NAME [NEUES_KENNWORT]   # ohne Angabe wird ein Zufallskennwort ausgegeben
  BrowserCAD --make-admin NAME
  ```
  (macOS: `BrowserCAD.app/Contents/Resources/BrowserCAD-server --reset-password NAME`)
* Empfehlung: nach dem Anlegen der Nutzer in `config.json` `"allowRegistration": false` setzen – dann legt nur noch der Administrator Nutzer an.

## Dateien neben der Programmdatei

| Datei / Ordner | Inhalt |
|---|---|
| `config.json` | Ports, Registrierung, Konverter (wird beim ersten Start angelegt) |
| `users.json` | Nutzerliste im Klartext (Name, Anlagedatum, Ordner) – **das Kennwort nur als PBKDF2-SHA256-Hash** |
| `daten/<nutzer>/` | Eigener Ordner je Nutzer (wird beim Anlegen erstellt): alle `.ccad`-Dateien, automatisch gespeichert |
| `daten/_geloescht/` | Datenordner gelöschter Nutzer (zur Sicherheit verschoben, nicht vernichtet) |
| `cert.pem`, `key.pem` | Selbstsigniertes Zertifikat für HTTPS (wird automatisch erzeugt) |

`config.json`:
```json
{
  "port": 8080,
  "https": true,
  "httpsPort": 8443,
  "openBrowser": true,
  "allowRegistration": true,
  "registrationCode": "",
  "converters": {}
}
```
* `allowRegistration: false` sperrt die Seite „Nutzer anlegen“ (nach dem Einrichten empfohlen). `registrationCode` verlangt zusätzlich einen Code.
* Nach Änderungen die Programmdatei neu starten.

## Funktionen

**Dokumente:** Teil (`.ccad`, JSON) und Baugruppe (`.ccad`, JSON). Das eigene Format ist ein offenes, lesbares JSON mit Feature-Baum, Ebenen und eingebetteten Importdaten.

**Teil (parametrischer Feature-Baum, wird bei jeder Änderung neu aufgebaut):**
Skizze (Linien/Rechteck/Kreis, Raster, numerische Bearbeitung) auf FRONT/TOP/RIGHT, Datumebenen oder ebenen Flächen · Extrusion (hinzufügen/entfernen, symmetrisch) · Rotation · Bohrung · Rundung · Fase · Linearmuster · Kugel · Kegel · Datumebene · Unterdrücken · Umbenennen · Löschen · Rückgängig/Wiederholen · Live-Vorschau im Dashboard unten (✔/✖ wie in Creo).

**Baugruppe:** Teile aus dem eigenen Ordner als Komponenten einfügen, numerisch platzieren/drehen, **Fläche-auf-Fläche verbinden** (Passend/Bündig mit Abstand), ein-/ausblenden, entfernen.

**Ebenen (Layers) wie in Creo:** Ebenen anlegen/umbenennen/löschen, Elemente per Rechtsklick zuordnen, Ebene ein-/ausblenden; zusätzlich Einzelelemente ausblenden (Auge im Baum). Standardebenen: `DATUM_EBENEN`, `SKIZZEN`, `GEOMETRIE`, `KOMPONENTEN`.

**Ansicht:** Standardorientierung, Front/Oben/Rechts/…, perspektivisch/orthogonal, schattiert mit Kanten / schattiert / Drahtmodell / verdeckte Linien / transparent, Datumebenen ein/aus, Bildschirmfoto.
Navigation wie Creo: Mitteltaste = drehen, Strg+Mitteltaste/Rad = zoomen, Umschalt+Mitteltaste = verschieben (ohne Mittelmaustaste: Alt+Linke Taste).

**Einheiten:** Alle Längenmaße werden **in Millimetern** angegeben und immer mit Einheit angezeigt (`20 mm`, `Ø8 mm`, Winkel in `°`; Eingabefelder tragen `[mm]`). STEP-Dateien werden beim Import nach mm umgerechnet, STL-Dateien gelten als mm.

**Rundung/Fase mit Live-Vorschau:** Schon nach dem Anklicken einer Kante (und bei jeder Radiusänderung) erscheint das Ergebnis – der Originalkörper bleibt als transparenter Geist stehen, damit weitere Kanten gewählt werden können. Erst ✔ übernimmt, ✖ verwirft.

**Maße / Bemaßung:**
* **Maße im Bild:** Sobald eine Skizze oder ein Feature (Extrusion, Bohrung, Kugel, Kegel, Muster, Rundung …) in Bearbeitung ist – oder im Modellbaum gewählt wird –, werden dessen Maße direkt im Grafikfenster eingeblendet. **Anklicken eines Maßes** öffnet ein Eingabefeld (Enter übernimmt, Esc verwirft); die Geometrie wird sofort neu berechnet. Rechtsklick auf ein Maß: bearbeiten/löschen. Ein-/Ausblenden: Ansicht → „Maße“.
* **Bemaßungswerkzeug in der Skizze** (Register Modell → Bemaßung → „Skizzenmaß“ oder Werkzeug „⟷ Bemaßung“ im Skizzenfenster): zwei Punkte anklicken (Ecken, Mittelpunkte, Kreisquadranten, Ursprung), Art wählen (ausgerichtet/horizontal/vertikal). Das Maß steuert die Geometrie: Wert ändern verschiebt bzw. skaliert die zweite Entität. Optional „Lagemaße“ (Abstände vom Ursprung).
* **Bemaßungswerkzeug am Körper** (Modell → Bemaßung → „Körper bemaßen“): Kantenlänge, Durchmesser/Radius einer Kreiskante, Abstand zweier paralleler ebener Flächen. Das sind **Referenzmaße**: sie werden bei jeder Regeneration neu aus der Geometrie berechnet, sind aber nicht änderbar; verschwindet das Bezugselement, erscheinen sie rot als „veraltet“. Zum Ändern einer Größe das zugehörige Feature bearbeiten (dessen Maße sind änderbar).

**Analyse:** Volumen, Oberfläche, Masse (einstellbare Dichte), Schwerpunkt, Abmessungen.

**Import:** `.stp/.step`, `.stl`; **Creo** (`.prt`, `.asm`) und **SolidWorks** (`.sldprt`, `.sldasm`) siehe unten.
**Export:** `.stp` (STEP, B-Rep) und `.stl` (Netz, Qualität wählbar) – für Teil und Baugruppe. Außerdem jederzeit **Download** der `.ccad`-Datei und **aller Dateien als ZIP**.

**Speichern:** Automatisch ca. 1,5 s nach jeder Änderung in `daten/<nutzer>/`; die vorherige Version bleibt als `.bak` erhalten.

## Creo- und SolidWorks-Dateien – wichtig

`.prt/.asm` (Creo) und `.sldprt/.sldasm` (SolidWorks) sind **proprietäre Binärformate**, für die es keinen freien Leser gibt. Sie lassen sich deshalb nicht direkt im Browser lesen. Zwei Wege:

1. **Aus Creo/SolidWorks als STEP exportieren** (Datei → Speichern unter/Kopie speichern → STEP) und diese Datei importieren. Das ist der zuverlässige Weg und verlustarm.
2. **Server-Konverter einrichten:** In `config.json` einen Kommandozeilen-Konverter eintragen. BrowserCAD ruft ihn auf und importiert die erzeugte STEP-Datei:
   ```json
   "converters": {
     ".sldprt": ["C:\\Tools\\konverter.exe", "{in}", "{out}"],
     ".prt":    ["C:\\Tools\\konverter.exe", "{in}", "{out}"]
   }
   ```
   `{in}` = Eingabedatei, `{out}` = Ziel-STEP-Datei. Geeignet sind z. B. FreeCAD (per Skript), CAD Exchanger oder Datakit – das Programm selbst wird nicht mitgeliefert.

## 3Dconnexion SpaceMouse

Unterstützung über **WebHID** (Chrome/Edge). Browser erlauben WebHID nur in einem „sicheren Kontext“:

* am selben Rechner: `http://localhost:8080` – funktioniert direkt,
* von anderen Rechnern: **`https://<IP>:8443`** (selbstsigniertes Zertifikat, Warnung einmalig bestätigen).

Werkzeuge → SpaceMouse → *Verbinden*. Dort lässt sich die Achsenzuordnung (Schieben/Zoomen/Drehen/Rollen), Invertierung und Empfindlichkeit einstellen, mit Live-Anzeige der sechs Achsen. Tasten: Taste 1 = Ansicht anpassen, Taste 2 = Standardorientierung. Falls sich das Gerät nicht öffnen lässt, den 3Dconnexion-Treiber beenden (er belegt das Gerät exklusiv).

## Warum OpenCascade statt usd-brep?

Das Projekt [NVIDIA-Omniverse/usd-brep](https://github.com/NVIDIA-Omniverse/usd-brep) ist eine C++/Python-Bibliothek (NURBS-B-Rep für OpenUSD) mit eigenem Build-System (Packman/Premake) und läuft nicht im Browser. Für eine einzelne, per GitHub Actions gebaute Programmdatei mit Browser-Oberfläche wird stattdessen **OpenCascade** (WASM, über OpenCascade.js) als B-Rep-Kern verwendet – derselbe Typ von Kern (STEP, Boolesche Operationen, Rundungen). Die Geometrie wird im Browser des Nutzers gerechnet, der Server speichert nur Dateien.

## Aufbau des Repos

```
main.go, auth.go, api.go, tlsgen.go   Go-Server (nur Standardbibliothek)
server_test.go                        Tests: Anmeldung, Dateien, Hash
web/login.html, register.html         Anmelde- und „Nutzer anlegen“-Seite
web/app.html, web/app/*.js            CAD-Programm (nur nach Anmeldung abrufbar)
web/vendor/                           wird vom Workflow erzeugt (three.js, OpenCascade.js)
scripts/fetch-vendor.mjs              kopiert die Bibliotheken nach web/vendor
tests/*.test.mjs                      Tests: CAD-Kern, Maß-Logik, Oberfläche und Ablauf Rundung (jsdom)
build/                                Programm-Icon (PNG, ICO, Iconset)
.github/workflows/build.yml           Build + Release (exe, macOS-App, Linux)
```

### Lokal entwickeln
```bash
npm install
npm run vendor        # three.js + OpenCascade.js nach web/vendor
npm test              # Kern-Tests
go run .              # Server starten (Daten im aktuellen Ordner)
```

## Sicherheit
* Kennwörter werden mit PBKDF2-HMAC-SHA256 (150 000 Runden, Salt) gespeichert; Sitzungen per HttpOnly-Cookie; Bremse gegen Kennwort-Raten (8 Fehlversuche je IP / 5 Min.).
* Der Server ist für das **vertrauenswürdige lokale Netzwerk** gedacht, nicht für das offene Internet. Ohne HTTPS laufen Kennwörter im Klartext durchs LAN – im Zweifel `https://…:8443` benutzen.
* Dateinamen werden strikt geprüft (kein Zugriff außerhalb des Nutzerordners).

## Bekannte Grenzen
* Skizzen: Linien/Rechteck/Kreis ohne Zwangsbedingungen (Bemaßung durch Zahleneingabe); Profile werden einzeln verarbeitet, verschachtelte Löcher in einem Profil nicht automatisch – dafür „Material entfernen“ nutzen.
* Rundung/Fase: Kanten werden über ihre Lage referenziert; ändert sich die Geometrie davor stark, kann die Referenz verloren gehen (Feature wird dann rot markiert).
* STL-Import ergibt ein Dreiecksnetz (Schale), kein Volumenkörper – Boolesche Operationen damit sind eingeschränkt.
* Baugruppen: nur Teile (keine Unterbaugruppen), Verbindungen sind einmalige Platzierungen, keine dauerhaften Bedingungen.
* Berechnungen laufen im Browser-Hauptthread; sehr große Dateien können die Oberfläche kurz blockieren.
