# Agent A6 - KMZ archive layout + XML declaration + namespaces

Scope: the container shell of the DJI KMZ archive emitted by
`backend/app/services/export/formats/kmz.py` and the per-file XML
prologue emitted by `backend/app/services/export/dji/builders.py`.
Specifically: ZIP entry paths/case, XML declaration text, KML and WPML
namespace declarations on the root element, prefix usage, BOM, encoding,
file extension and MIME type. The audit is against:

- WPML 1.0.6 spec (`10.overview.md`, `20.template-kml.md`,
  `30.waylines-wpml.md`, fetched 2026-05-26).
- The §2.5 fix in `docs/audits/2026-05-15-dji-wpml-spec-audit.md`.
- A real DJI Pilot 2 export at `docs/specs/PAPI 22.kmz` used as a
  ground-truth reference for byte-level formatting choices the spec
  text does not pin down.

Sibling agents own neighbouring scopes. Anything **inside** the XML root
(`<Document>`, `<wpml:missionConfig>`, placemarks, etc.) is out of scope
here - A3 / A4 / B1-B5 / C2 own those.

## Reference exporter / spec excerpts

`formats/kmz.py` (lines 58-63):

```
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("wpmz/template.kml", template_kml)
    zf.writestr("wpmz/waylines.wpml", waylines_wpml)
```

`dji/builders.py` (line 137 and 264 - the only two `ET.tostring` sites
in the DJI export):

```
return ET.tostring(kml, encoding="UTF-8", xml_declaration=True)
```

`shared.py` namespace registration (lines 13-19):

```
_KML_NS = "http://www.opengis.net/kml/2.2"
_WPML_NS = "http://www.dji.com/wpmz/1.0.6"
_KML = f"{{{_KML_NS}}}"
_WPML = f"{{{_WPML_NS}}}"
ET.register_namespace("", _KML_NS)
ET.register_namespace("wpml", _WPML_NS)
```

WPML 1.0.6 `overview.md` (KMZ archive layout):

```
<route>.kmz
└── wpmz/
    ├── template.kml      planning view (Pilot 2 displays/edits this)
    ├── waylines.wpml     the executable flight path (the drone flies THIS)
    └── res/              optional auxiliary resources
```

Spec text: *"Please follow this specification for the naming of each
file or folder in the route file, otherwise the route file may fail to
be read."*

DJI Pilot 2 reference file (`docs/specs/PAPI 22.kmz`), first two lines
of `wpmz/template.kml`:

```
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
```

(No BOM - first byte is `0x3c` = `<`. Lines indented with two spaces.
Trailing newline after `</kml>`.)

## Findings

### CLEAN-1 - ZIP layout matches the spec exactly

The two `zf.writestr` calls use the literal paths `wpmz/template.kml`
and `wpmz/waylines.wpml` - lowercase `wpmz/` folder, lowercase
`template.kml` / `waylines.wpml` file names, matching the spec
verbatim. `test_produces_dji_wpmz_archive_layout` in
`test_export_service.py` pins the namelist to exactly
`{"wpmz/template.kml", "wpmz/waylines.wpml"}` so a typo regression
trips CI immediately.

Pilot 2's own export (`docs/specs/PAPI 22.kmz`) uses the same two
paths.

### CLEAN-2 - WPML namespace URI matches 1.0.6

`shared.py` declares `_WPML_NS = "http://www.dji.com/wpmz/1.0.6"`,
which matches:
- the namespace declared by the Pilot 2 reference KMZ (`PAPI 22.kmz`),
- the version the WPML model `M4T` actually consumes,
- `test_declares_wpmz_1_0_6_namespace`, which positively asserts the
  `1.0.6` URI and negatively asserts that `1.0.2` is **not** present.

The spec documentation samples still show `1.0.2` (the doc set has
not been updated alongside Pilot 2's runtime), but the runtime is what
matters - `kmz-wpml-audit.md` §2 records this divergence and the
"silently drops elements for the declared version" failure mode. The
exporter is on the runtime-correct value.

### CLEAN-3 - KML namespace URI is exact

`_KML_NS = "http://www.opengis.net/kml/2.2"` matches the OGC KML 2.2
URI used by every spec sample and by the Pilot 2 reference. No trailing
slash, `http://` not `https://`, no typo.

### CLEAN-4 - Element prefix usage

`_kml_tag(name)` returns Clark-notation `{http://www.opengis.net/kml/2.2}name`;
`_wpml_tag(name)` returns Clark-notation
`{http://www.dji.com/wpmz/1.0.6}name`. `ET.register_namespace("", _KML_NS)`
makes the KML namespace the default (unprefixed) and
`ET.register_namespace("wpml", _WPML_NS)` binds the lowercase `wpml:`
prefix. Result: KML elements (`kml`, `Document`, `Folder`, `Placemark`,
`Point`, `coordinates`, etc.) emit without a prefix; every WPML element
emits with the lowercase `wpml:` prefix. Every call site of
`_sub_text(...)` routes through `_wpml_tag`, so accidentally writing
`<wpml:Placemark>` or `<Document>` with the WPML namespace is
structurally not reachable through the public helper API. Pilot 2's
reference export uses the same prefix convention.

### CLEAN-5 - No BOM

`ET.tostring(..., encoding="UTF-8", xml_declaration=True)` writes raw
bytes starting at `0x3c` (`<`), with no UTF-8 BOM (`0xEF 0xBB 0xBF`)
prepended. Confirmed by inspecting the byte output of the exporter and
matches the Pilot 2 reference (`PAPI 22.kmz` starts at `0x3c` likewise).

### CLEAN-6 - No password / standard DEFLATE

`zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)` uses the standard
ZIP DEFLATE compression with no password / encryption parameters. Spec
does not forbid other ZIP compression modes, but DEFLATE is the
universally supported default and matches the Pilot 2 reference.

### CLEAN-7 - Filename extension + MIME type

`export/orchestrator.py::_EXPORT_CONTENT_TYPES["KMZ"]` returns
`("application/vnd.google-earth.kmz", "kmz")`. The MIME type is the
registered IANA type for KMZ and the file extension is `.kmz`
(lowercase) - both correct.

### CLEAN-8 - Encoding header uppercase `UTF-8`

`ET.tostring(..., encoding="UTF-8", ...)` writes the encoding attribute
exactly as `UTF-8` (uppercase). Audit §2.5 in
`docs/audits/2026-05-15-dji-wpml-spec-audit.md` documents the case
sensitivity fix and it stays in place. Both
`_build_dji_template_kml` and `_build_dji_waylines_wpml` use the
uppercase spelling.

### CLEAN-9 - No `res/` folder is emitted

The exporter only writes the two required entries. The spec marks
`res/` as optional (reference photos for AI Spot-Check); the
TarmacView export does not generate AI Spot-Check companions, so
omitting `res/` is correct. No code path under `export/` references
`res/`. Geozone keep-out polygons are emitted as a *KML Folder inside
`template.kml`* (`_append_dji_template_keepouts`), not as ZIP entries -
so they do not need `res/` either.

## P3-1 - XML declaration uses single quotes (Pilot 2 reference uses double quotes)

**Severity: P3 (upgrade / conformance polish).**

Python's `xml.etree.ElementTree.tostring(..., xml_declaration=True)`
emits the prologue with **single-quoted** attributes:

```
<?xml version='1.0' encoding='UTF-8'?>
```

The WPML spec samples (and the Pilot 2 reference `PAPI 22.kmz`) all
use **double quotes**:

```
<?xml version="1.0" encoding="UTF-8"?>
```

Both forms are well-formed XML per the W3C spec - `Eq` in the XMLDecl
production accepts either quote style and the WPML doc set never
explicitly demands one. Pilot 2 has tolerated the single-quote form
in every flight verified so far (the file imports today). This is the
*only* surface byte-level divergence between our header and the Pilot
2 reference once the §2.5 case fix is in place.

Why P3 not P2: I have no evidence of a real WPML consumer rejecting
single quotes, and the spec does not require double quotes. Logging
it because (a) the easy fix is one extra line per builder, (b) byte-
matching the Pilot 2 reference helps the diff harness in
`kmz-wpml-audit.md` §10 stay focused on substantive differences, and
(c) if a future Pilot 2 release tightens its parser, this becomes a
P0 overnight.

If we want to fix this:

```python
xml_bytes = ET.tostring(kml, encoding="UTF-8", xml_declaration=False)
return b'<?xml version="1.0" encoding="UTF-8"?>\n' + xml_bytes
```

Two-line change in both `_build_dji_template_kml` and
`_build_dji_waylines_wpml`. The tests in `test_export_service.py`
that grep on element substrings still pass (they do not pin the
prologue quote style).

## P3-2 - Output not pretty-printed (single-line XML body)

**Severity: P3 (upgrade / conformance polish).**

`ET.tostring` defaults to no indentation. Our output for `wpmz/template.kml`
looks like:

```
<?xml version='1.0' encoding='UTF-8'?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6"><Document><wpml:author>TarmacView</wpml:author>...
```

The Pilot 2 reference is indented with two spaces and a newline after
every element. Same XML semantically; the spec does not require
indentation. Pilot 2 ingests our single-line form (`test_export_service`
verifies element presence by string-grep; the import has succeeded on
the bench).

Why P3 not P2: no validator I am aware of rejects unindented XML.
Pretty-printing would help operator-side debugging (open in a text
editor and read it). It would also match the Pilot 2 reference more
closely for the diff harness.

If we want to fix this, `ET.indent(kml, space="  ")` before `tostring`
on Python 3.9+ gives the two-space indent shape Pilot 2 emits. The byte-
identity tests in `test_export_service.py` that grep on substrings
still pass; tests that pin `useGlobal*` quartets and `gimbalRotate`
emission also pass because they walk the tree, not the string. Anything
that compares whitespace would need an update (none observed in the
suite I scanned, but worth a full `ruff check` + `pytest` pass before
merging).

## P3-3 - Trailing newline absent after closing `</kml>`

**Severity: P3 (cosmetic).**

`ET.tostring` does not append a trailing newline. The Pilot 2 reference
file ends with `</kml>\n`. POSIX-friendly newline-terminated text; not
a parser requirement.

Fix would land naturally if P3-1 is fixed (append `b"\n"` to the
returned bytes).

## P3-4 - No ZIP-level metadata customization

**Severity: P3 (cosmetic).**

`zipfile.ZipFile.writestr(name, data)` (with a `str` first arg) sets
the entry's modification time to `(1980, 1, 1, 0, 0, 0)` - the ZIP
epoch zero - and `external_attr` to `0o600 << 16`. Pilot 2's own KMZ
files also report `00-00-1980 00:00` mtimes when unzipped, so this is
behaviour-matched with the reference. No fix needed; logged so a
future reader does not "fix" it back.

## Verified clean - no findings

- File ordering inside the ZIP: spec does not mandate an order; we
  always write `template.kml` then `waylines.wpml`. Pilot 2 reads by
  filename, not by ordinal, so this is irrelevant.
- Default namespace vs. prefix collision: `register_namespace("",
  _KML_NS)` + `register_namespace("wpml", _WPML_NS)` is unambiguous;
  no element ends up with a different prefix on different runs.
- Internal ZIP fields (CRC32, version-needed-to-extract, general-purpose
  flag): the stdlib `zipfile` writes the spec-conformant defaults; the
  Pilot 2 reference unpacks the same way and our output unpacks with
  the standard `unzip` toolchain.
- KMZ extension capitalization: every call site fixes the
  `Content-Disposition` filename through
  `_resolve_export_content_type(...)` which returns the lowercase
  `kmz` extension. No place generates `.KMZ` or `.Kmz`.

## Severity tally

- **P0 (BLOCKER):** 0
- **P1:** 0
- **P2:** 0
- **P3:** 4 (XML decl quote style, pretty-printing, trailing newline,
  ZIP mtime cosmetics)
- **CLEAN:** 9

## Recommendation

The container shell is in good shape - every required spec invariant
holds (correct paths, correct namespace URIs and prefix usage, exact
uppercase `UTF-8`, no BOM, standard DEFLATE, correct `.kmz` extension
and MIME). All four findings are conformance/cosmetic polish, not
blockers.

If we want a one-shot "byte-match the Pilot 2 reference" sweep, fix
P3-1 + P3-2 + P3-3 together - three to five lines per builder, no
behaviour change. Otherwise the current shape is correct and shipping.
