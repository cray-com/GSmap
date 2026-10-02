# Projekt

## Ziel

GSmap wird als browserbasierte Kartenanwendung für Publishing-Arbeiten weiterentwickelt. Nutzer wählen einen Kartenausschnitt, laden Koordinatenpunkte aus JSON und exportieren die Karte mitsamt Punkten als PNG. Für die Nutzung sind weder Konto noch Backend erforderlich.

## Architektur

- React und TypeScript bilden Oberfläche und Zustand.
- MapLibre rendert OpenFreeMap-Vektorkarten im Browser.
- `src/MapView.tsx` besitzt Karteninteraktion, Auswahl und die separate PNG-Exportkarte.
- PNG rendert einen Schnappschuss des aktuellen Kartenstils mitsamt Nutzerpunkten und Labels, ohne die Vorschau umzubauen.
- Abweichende Ausgabeproportionen erhalten zentrierte Ränder statt Verzerrung oder zusätzlich exportiertem Kartengebiet.
- Datenparser und Ausgabegrößen bleiben von React und MapLibre getrennt und werden direkt getestet.

## Aktueller Fokus

GSmap2 als erste veröffentlichbare Version abschließen:

- JSON/GeoJSON importieren, Punkte und Beschriftungen im eigenen Menü verwalten.
- Einzelne Punkte in einem ausdrücklich aktivierten Klickmodus ergänzen und rückgängig machen.
- Einen Ausschnitt interaktiv oder über JSON-Grenzen definieren.
- PNG in festen Pixelgrößen sowie A4/A3 bei 300 DPI exportieren.
- 1x–4x müssen echte unterschiedliche Abmessungen liefern, unabhängig vom Display-Pixelverhältnis.
- Exportgröße vorab prüfen; bei Browser-/Grafiklimits Fehler statt still verkleinerter Ausgabe.
- Export mit echten Browserchecks prüfen und eine aktualisierte Vorschau bereitstellen.

Der bestehende SVG-Export bleibt unverändert und wird als experimentell gekennzeichnet. Eigene Veröffentlichung und Pull Requests sind ein späterer Auftrag.

## JSON-Vertrag

```json
{
  "bounds": {
    "south": 48.18,
    "west": 16.31,
    "north": 48.24,
    "east": 16.43
  },
  "pins": [
    {
      "id": "kunde-1",
      "lat": 48.2082,
      "lon": 16.3738,
      "label": "Standort Wien"
    }
  ]
}
```

`bounds`, `id` und `label` sind optional. `pins` ist erforderlich. Koordinaten werden als WGS84-Breitengrad und Längengrad interpretiert.

## Pin-Import und native Punktdarstellung

Der Import läuft vollständig im Browser. Unterstützt werden der dokumentierte `{pins:[{lat,lon,...}], bounds?}`-Vertrag, GeoJSON-`FeatureCollection` mit Point-Features (`coordinates` ist `[lon,lat]`) und Top-Level-Arrays mit case-insensitive `latitude/longitude`, `lat/lon` oder `lat/lng`. Der erkannte Adapter und die Koordinatenfelder werden angezeigt; Original-Eigenschaften bleiben erhalten. Beschriftungsfelder werden aus skalaren Eigenschaften erzeugt (Koordinaten ausgeschlossen), bevorzugt `label`, `name`, `title`, `project`, `location_name`, `id`, danach alphabetisch. Das automatisch gewählte Feld kann im nativen Punktmenü geändert werden; die Auswahl zeigt zusätzlich, bei wie vielen Datensätzen das Feld befüllt ist.

Identische Koordinaten werden zu einem Punkt aggregiert, ohne räumliche Verschiebung. Die native Circle-Layer-Größe kann optional mit `sqrt(duplicateCount)` skaliert werden und hat eine konfigurierbare Obergrenze; Labels skalieren nie. Eine separate native Symbol-Layer bietet die konfigurierbaren Beschriftungen. Optional kann das Label bei aggregierten Punkten die Anzahl zusätzlicher Datensätze als Suffix anzeigen. PNG enthält beide Layer, SVG bleibt unverändert und enthält keine Nutzerpunkte.

## Zusätzliche Themes

Monochrome, Warm Paper und Blueprint verwenden Positrons vorhandene Geometrie, Zoomregeln und Schriften mit lokalen Farbpaletten. Es werden keine weiteren Anbieter, API-Schlüssel oder Lizenzen benötigt. Nutzerfarben und Sichtbarkeitsschalter gelten weiterhin.

## Später

- Kartenschriften und Pin-Typografie ersetzen.
- Größere Poster bei nachgewiesenem Bedarf aus mehreren Teilbildern zusammensetzen.
- Eigenständige öffentliche Veröffentlichung und getrennte Pull Requests prüfen.
