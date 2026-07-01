# Airport-lighting inspection protocols

Real-world flight-measurement protocols from Zephyr, kept as the source
templates for the mission-scale results page (merge plan Phase 3 in
[`TARMACVIEW-MERGE-PLAN.md`](../../specs/TARMACVIEW-MERGE-PLAN.md)). They are
reference material only - no code reads them at runtime. The files are Slovak
`.xlsx` and follow the L-14 (Annex 14) airport-lighting requirements.

| File | Method | Airport | What it is |
|------|--------|---------|------------|
| `lps-SZZ-Protokol-02-2025-LZZI.xlsx` | drone (UAS, DJI Matrice 4E + RTK) | LZZI | primary results-page template |
| `zephyr-SZZ0324-LZIB-PAPI-PLM.xlsx` | manned aircraft (L-410, regular flight measurement) | LZIB | manned equivalent + per-runway serviceability appendix |

## lps - drone protocol

Single sheet, top-to-bottom. This is the structure the results page mirrors:

- **session header** - protocol number, date, operator, pilot/specialist, UAS
  type + serial + optical sensor, reference system, verification type.
- **weather** - visibility and cloud base, wind, temperature, UTC time.
- **per-device sections** - one block per device (THR/EDGE/END edge lighting,
  PAPI per runway end) measuring the L-14 parameters: chromaticity, luminous
  intensity, horizontal/vertical coverage, attenuation, descent angle, sector
  width below the glide plane, transition angles, MEHT and obstacle-clearance
  plane checks.
- **evaluation table** - device / parameter / nominal value / tolerance /
  result / note.
- **limitations, recommendations, prepared-by + signature**.

## zephyr - manned protocol

One overview sheet (`LZIB`) plus one sheet per runway end/approach
(`CAT I. RWY 22`, `NPA RWY 04`, `CAT III. RWY 31`, `NPA RWY 13`). Header covers
the calibration aircraft, onboard measurement system, crew, and the same weather
+ reference-system fields. Parameters mirror the drone protocol (chromaticity,
intensity, coverage, attenuation, descent angle, colour-change and transition
angles, inter-signal angles, alignment with the ILS glide plane) and add flash
array, backup source, and deceptive-light checks. The per-runway sheets are the
light-array serviceability appendix the drone protocol does not have.

## Mapping to the results page

The evaluation table drives the PASS/FAIL rollup: measured value vs
`LHA.setting_angle` +/- `LHA.tolerance` for the transition-angle rows. Keep the
device ordering (session header -> weather -> per-device -> overall evaluation ->
recommendations -> signature) when laying out the mission report so the exported
PDF reads like these protocols.
