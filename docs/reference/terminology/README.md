# Official aviation terminology (AIP GEN 2.2)

The authoritative source for aviation abbreviations, term expansions, and
spellings used across TarmacView. The PDF [`LZ_GEN_2_2_en.pdf`](./LZ_GEN_2_2_en.pdf)
is the Slovak AIP (Aeronautical Information Publication) section **GEN 2.2 -
Abbreviations used in AIS publications**, published by Letové prevádzkové služby
Slovenskej republiky (AIRAC AIP AMDT 04/26, effective 16 APR 26). It is the
bilingual (Slovak / English) ICAO-aligned glossary. Reference material only - no
code reads it at runtime.

When naming an aviation concept in UI strings, docs, or the glossary
([`CONTEXT.md`](../../../CONTEXT.md)), use the expansion and spelling this
document defines. It is the tiebreaker whenever the codebase uses more than one
word for the same thing.

## Conventions the AIP uses

- **British / ICAO spelling.** `centre` (not center), `metre` / `metres` (not
  meter), `kilometre`, `aeroplane`, `colour`. Runway centre line abbreviates to
  `RCL`.
- **Sentence-case expansions.** Only the first word is capitalised
  (`Precision approach path indicator`, not `Precision Approach Path Indicator`),
  except for proper nouns and embedded abbreviations (`RWY centre line light(s)`).
- **`RWY` inside expansions.** The runway-light abbreviations expand with the
  literal `RWY`, not the spelled-out word (`REDL = RWY edge light(s)`).

## TarmacView-relevant subset

The abbreviations that touch airport-lighting inspection, PAPI, runway geometry,
altitude datums, and drone navigation. Full list is in the PDF.

### Approach path indicators and lighting

| Abbr | Expansion |
|------|-----------|
| PAPI | Precision approach path indicator |
| VASIS | Visual approach slope indicator system |
| ALS | Approach lighting system |
| SALS | Simple approach lighting system |
| PALS | Precision approach lighting system |
| APCH | Approach |
| GP | Glide path |
| MEHT | Minimum eye height over threshold (for visual approach slope indicator systems) |
| TCH | Threshold crossing height |
| LGT | Light or lighting |
| LGTD | Lighted |
| LIH / LIM / LIL | Light intensity high / medium / low |
| LED | Light-emitting diode |
| INTST | Intensity |

### Runway lights

| Abbr | Expansion |
|------|-----------|
| RCL | RWY centre line |
| RCLL | RWY centre line light(s) |
| REDL | RWY edge light(s) |
| RENL | RWY end light(s) |
| RTHL | RWY threshold light(s) |
| RTZL | RWY touchdown zone light(s) |
| RTIL | Runway threshold identification light |

### Runway and surface geometry

| Abbr | Expansion |
|------|-----------|
| RWY | Runway |
| TWY | Taxiway |
| THR | Threshold |
| TDZ | Touchdown zone |
| RESA | Runway end safety area |
| FATO | Final approach and take-off area |
| TLOF | Touchdown and lift-off area |
| GRASS | Grass landing area |
| APN | Apron |
| LDA | Landing distance available |
| TORA / TODA / ASDA | Take-off run / take-off distance / accelerate-stop distance available |
| LEN | Length |
| WID | Width |

### Aerodrome

| Abbr | Expansion |
|------|-----------|
| AD | Aerodrome |
| ARP | Aerodrome reference point |
| ATZ | Aerodrome traffic zone |
| AAL | Above aerodrome level |
| ELEV | Elevation |

### Altitude, height, and vertical datums

| Abbr | Expansion |
|------|-----------|
| AGL | Above ground level |
| AMSL | Above mean sea level |
| MSL | Mean sea level |
| GND | Ground |
| ALT | Altitude |
| HGT | Height or height above |
| GUND | Geoid undulation |

`MSL` is the **datum** (mean sea level). `AMSL` is a height **relative to** that
datum (above mean sea level). They are not interchangeable.

### Navigation and positioning

| Abbr | Expansion |
|------|-----------|
| UAS | Unmanned aircraft system |
| WPT | Way-point |
| GNSS | Global navigation satellite system |
| GPS | Global positioning system |
| RNAV | Area navigation |
| LNAV / VNAV | Lateral / vertical navigation |
| HDG | Heading |
| BRG | Bearing |
| IAS / TAS | Indicated / true airspeed |

### Units and colours

| Abbr | Expansion |
|------|-----------|
| ft | Feet (dimensional units) |
| m | Metres |
| km | Kilometres |
| cm | Centimetre |
| kt | Knots |
| NM | Nautical mile |
| DEG | Degrees |
| R / G / B / W / Y | Red / green / blue / white / yellow |

## Applying this in TarmacView

Terms where the codebase currently disagrees with the AIP or with itself, and the
canonical form to converge on:

- **Glide path** (`GP`) is the AIP term for the approach beam angle. Prefer it in
  user-facing text over the mixed "glide slope" / "glidepath" / "glide-slope" the
  codebase uses today. Existing code identifiers, DB columns, and API fields
  (`glide_slope_angle`, ...) are not aviation terminology and stay as-is.
- **Light Housing Assembly** is the real term behind `LHA` (an individual PAPI
  light unit), matching [`SPEC.md`](../../specs/SPEC.md) and the model docstring.
  `LHA` is a project abbreviation - it is not in the AIP.
- **Centre**, not center, in displayed aviation text (`RCL = RWY centre line`).
  Route paths and directory names such as `operator-center/` are not display text.
