# Cloudflare Tunnel Monitor

Diese Integration überwacht deine **Cloudflare-Tunnel** (`cloudflared`) aus
Gladys heraus: Ist jeder Tunnel online, wie viele Verbindungen hält er, und ist
das `cloudflared` bei dir zu Hause noch verbunden? Jeder Tunnel wird zu einem
Gladys-Gerät, eine Statusänderung kann eine Szene starten, und ein
Dashboard-Widget zeigt alles auf einen Blick.

Sie **liest** nur: Sie erstellt, ändert oder löscht nie einen Tunnel.

## Zwei Quellen, nutze eine oder beide

| Quelle    | Was du brauchst                                | Was du bekommst                                                   |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| **Cloud** | Ein Cloudflare-API-Token und deine Konto-ID    | Alle Tunnel des Kontos, mit dem von Cloudflare berechneten Status |
| **Lokal** | Die Metrics-Adresse eines `cloudflared` im LAN | Den Zustand dieses Connectors — er antwortet auch ohne Internet   |

Am besten nutzt du beide: Die Cloud sieht alle Tunnel, der lokale Connector
antwortet noch, wenn genau die Internetverbindung ausgefallen ist.

### Cloud: das API-Token erstellen

1. Öffne das Cloudflare-Dashboard, dann **Mein Profil → API-Token**
   (<https://dash.cloudflare.com/profile/api-tokens>).
2. **Token erstellen → Benutzerdefiniertes Token → Los geht's**.
3. Gib ihm einen Namen (z. B. `Gladys`) und füge **eine einzige**
   Berechtigung hinzu: **Konto → Cloudflare Tunnel → Lesen**.
4. Unter **Kontoressourcen** schließt du das Konto mit deinen Tunneln ein.
5. **Weiter zur Zusammenfassung → Token erstellen**, dann kopiere das Token.
   Cloudflare zeigt es nur einmal an.

Das Token ist nur lesend: Selbst wenn es bekannt würde, könnte damit niemand
einen Tunnel ändern.

### Cloud: die Konto-ID finden

Öffne im Cloudflare-Dashboard dein Konto: Die **Konto-ID** steht auf der Seite
**Übersicht** (rechte Spalte) oder im Kontomenü → **Konto-ID kopieren**. Sie
hat 32 Zeichen: Ziffern und die Buchstaben `a` bis `f`.

### Lokal: die Metriken von cloudflared freigeben

`cloudflared` hat einen kleinen Metrics-Server. Standardmäßig lauscht er nur
auf dem Rechner selbst und auf einem zufälligen Port: Gib ihm eine feste
Adresse, die Gladys erreichen kann.

- Befehlszeile: füge `--metrics 0.0.0.0:2000` hinzu, zum Beispiel
  `cloudflared tunnel --metrics 0.0.0.0:2000 run --token <Tunnel-Token>`.
- `config.yml`: füge die Zeile `metrics: 0.0.0.0:2000` hinzu.
- Docker: dieselbe Option im Befehl, und veröffentliche den Port
  (`-p 2000:2000`).

Prüfe von einem anderen Rechner aus:
`curl http://<cloudflared-Host>:2000/ready` muss etwa
`{"status":200,"readyConnections":4,"connectorId":"…"}` antworten.

Der Metrics-Server zeigt keine Geheimnisse, aber lass ihn in deinem lokalen
Netzwerk: Öffne diesen Port nicht ins Internet.

## Konfiguration

| Feld                               | Bedeutung                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| **Cloudflare-API-Token**           | Das oben erstellte Token. Leer lassen, um nur lokale Connectoren zu nutzen.               |
| **Cloudflare-Konto-ID**            | Die oben gefundene ID mit 32 Zeichen.                                                     |
| **Lokale cloudflared-Connectoren** | Metrics-Adressen, durch Kommas getrennt: `http://192.168.1.10:2000, http://nas.lan:2000`. |
| **Prüfintervall (s)**              | Sekunden zwischen zwei Prüfungen, 30 bis 3600 (Standard 60).                              |

Der Schalter **Lokale Verbindung bevorzugen**, den Gladys unter dem Formular
anzeigt, entscheidet, welche Quelle für einen Tunnel mit beiden gezeigt wird
(siehe unten).

Klicke dann auf **Verbindung testen**: Die Antwort sagt für jede Quelle, was
geantwortet hat und was zu beheben ist.

## Geräte

Die Geräte erscheinen im Tab **Entdecken** der Integration: Füge die hinzu,
die du verfolgen willst.

### Ein Gerät pro Tunnel (Cloud)

| Funktion               | Werte                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| **Status**             | `healthy`, `degraded`, `down` oder `inactive`                              |
| **Online**             | 1, wenn der Tunnel Verkehr trägt (fehlerfrei oder beeinträchtigt), sonst 0 |
| **Active connections** | Anzahl der Verbindungen zum Cloudflare-Netz                                |

Was die Status bedeuten, laut Cloudflare:

- **healthy** (fehlerfrei): Der Tunnel funktioniert normal;
- **degraded** (beeinträchtigt): Er trägt noch Verkehr, aber es fehlen
  Verbindungen oder Connectoren;
- **down** (ausgefallen): keine Verbindung mehr, der Tunnel kann keinen Verkehr
  tragen;
- **inactive** (inaktiv): Der Tunnel wurde nie gestartet.

Ein in Cloudflare umbenannter Tunnel behält sein Gladys-Gerät: Das Gerät hängt
an der Tunnel-ID, nicht am Namen.

### Ein Gerät pro lokalem Connector

| Funktion              | Werte                                                  |
| --------------------- | ------------------------------------------------------ |
| **Ready**             | 1, wenn der Connector mindestens eine Verbindung hält  |
| **Ready connections** | Anzahl der Verbindungen, die er hält (standardmäßig 4) |

### Das Abzeichen an jedem Gerät

- **lokal**: Der Zustand kommt von einem `cloudflared` in deinem Netzwerk;
- **Cloud**: Er kommt von der Cloudflare-API;
- **nicht erreichbar**: Keine Quelle antwortet für dieses Gerät.

Bedient ein lokaler Connector einen Tunnel deines Kontos, verknüpft die
Integration sie selbst (über die Connector-ID, die Cloudflare meldet). Mit
eingeschaltetem **Lokale Verbindung bevorzugen** zeigt der Tunnel dann die
lokale Sicht, ausgeschaltet die Cloudflare-Sicht. Fällt die bevorzugte Quelle
aus, springt die andere ein, und das Abzeichen bekommt einen orangen Punkt mit
dem Grund.

## Szenen

### Auslöser

- **Ein Cloudflare-Tunnel ändert seinen Status** — Filter auf den Tunnel und
  den neuen Status. Variablen: Tunnelname, neuer Status, vorheriger Status,
  aktive Verbindungen. Beispiel: „Wenn der Tunnel `home` **Ausgefallen** wird,
  schick mir eine Nachricht“.
- **Ein lokaler cloudflared-Connector ändert seinen Status** — Filter auf den
  Connector und auf `Bereit`, `Nicht bereit`, `Nicht erreichbar`.
- **Die Cloudflare-API antwortet nicht mehr** — einmal ausgelöst, wenn die API
  zu versagen beginnt (Token abgelehnt, unbekanntes Konto, kein Internet…),
  nicht bei jeder Prüfung.

Jeder Auslöser feuert **einmal pro Änderung**. Der letzte bekannte Status wird
auf der Festplatte gespeichert: Eine Änderung während eines Gladys-Neustarts
wird trotzdem erkannt.

### Aktionen

- **Cloudflare-Tunnel jetzt prüfen** — startet sofort eine Prüfung. Liefert:
  Anzahl der Tunnel, fehlerfreie Tunnel, Tunnel mit Problem und „alle Tunnel
  fehlerfrei“ (ja/nein), zum Prüfen in den folgenden Aktionen.
- **Status eines Tunnels lesen** — liefert Name, Status, online (ja/nein) und
  aktive Verbindungen eines Tunnels oder lokalen Connectors aus der letzten
  Prüfung.

## Dashboard-Widget

Füge das Widget **Cloudflare-Tunnel** zu einem Dashboard hinzu. Es zeigt:

- die Anzahl fehlerfreier Tunnel und der Tunnel mit Problem;
- die Anzahl bereiter lokaler Connectoren (falls vorhanden);
- eine Zeile pro Tunnel (Probleme zuerst) und pro Connector, mit Status und
  Verbindungen;
- eine Schaltfläche **Jetzt prüfen**.

## Fehlerbehebung

| Meldung                                             | Was tun                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare lehnt das API-Token ab                   | Prüfe das Token und seine Berechtigung **Konto → Cloudflare Tunnel → Lesen**.                 |
| Cloudflare kennt diese Konto-ID nicht               | Kopiere die Konto-ID erneut; prüfe, dass das Token dieses Konto einschließt.                  |
| Die Cloudflare-API ist nicht erreichbar             | Prüfe den Internetzugang von Gladys (DNS, Firewall).                                          |
| Ein Connector zeigt **keine Antwort**               | Prüfe `--metrics 0.0.0.0:<Port>` bei cloudflared, den Port und `curl http://host:port/ready`. |
| Ein Connector antwortet, hält aber keine Verbindung | cloudflared läuft, erreicht Cloudflare aber nicht: sieh in seine eigenen Logs.                |

## Datenschutz

Das Token wird in Gladys gespeichert und nur an `api.cloudflare.com` gesendet,
über HTTPS. Es wird nie in die Logs geschrieben. Lokale Connectoren werden in
deinem Netzwerk gelesen, ganz ohne Token.
