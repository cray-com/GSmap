# Projekt

## Ziel

GSmap wird als browserbasierte Kartenanwendung für Publishing-Arbeiten weiterentwickelt. Nutzer wählen einen Kartenausschnitt, laden Koordinatenpunkte aus JSON und exportieren die Karte mitsamt Punkten als PNG. Für die Nutzung sind weder Konto noch Backend erforderlich.

## Architektur

- React und TypeScript bilden Oberfläche und Zustand.
- MapLibre rendert OpenFreeMap-Vektorkarten im Browser.
- `src/MapView.tsx` besitzt Karteninteraktion, Auswahl und PNG-Aufnahme.
- Datenparser bleiben von React und MapLibre getrennt und werden direkt getestet.

## Aktueller Fokus

Ausbaustufe 1:

- Pins aus einem JSON-Objekt laden.
- Optionale Pin-Beschriftungen unterstützen.
- Einen Ausschnitt interaktiv oder über JSON-Grenzen definieren.
- Pins und Beschriftungen in Vorschau und PNG-Export erhalten.
- PNG herunterladen.

Schrift- und Theme-Anpassungen gehören zu Ausbaustufe 2. Der bestehende SVG-Export bleibt vorerst unverändert.

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

## Pin-Import und Templates

Der Import läuft vollständig im Browser. Unterstützt werden der dokumentierte `{pins:[{lat,lon,...}], bounds?}`-Vertrag, GeoJSON-`FeatureCollection` mit Point-Features (`coordinates` ist `[lon,lat]`) und Top-Level-Arrays mit case-insensitive `latitude/longitude`, `lat/lon` oder `lat/lng`. Der erkannte Adapter und die Koordinatenfelder werden angezeigt; Original-Eigenschaften bleiben erhalten. Beschriftungen werden deterministisch aus `label`, `name`, `title`, `project`, `location_name`, `id` gewählt.

Identische Koordinaten werden zu einem Pin aggregiert. Die Größe skaliert mit `sqrt(duplicateCount)` und ist begrenzt; `duplicateCount` und `duplicateScale` stehen im Template zur Verfügung. Es gibt keine räumliche Verschiebung und kein erforderliches Badge.

HTML- und CSS-Pinvorlagen werden als sicherer, absichtlich kleiner Subset behandelt: `div`, `span`, Text und wenige typografische/Box-Eigenschaften. Platzhalter sind `{{field}}` und werden HTML-escaped. JavaScript, Event-Handler, iframe/object/embed, externe URLs, `url()` und `@import` werden abgelehnt. Die Vorlage wird zu einem hochauflösenden MapLibre-Rasterbild gerendert, dadurch sind Vorschau, Map-Style-Wechsel und PNG identisch; SVG bleibt pinfrei. Uploads akzeptieren `.json`, `.geojson`, `.html` und `.css`.

## Später

- Kartenschriften und Pin-Typografie ersetzen.
- Theme-Farben weiter anpassen.
- Zusätzliche Druckformate und feste physische Ausgabegrößen prüfen.
