# geozone golden fixtures

example artifacts produced by the export generators when
`include_geozones=True`. these are reference shapes used by
`backend/tests/test_export_service.py::TestGeozoneEmission*` to assert
the wire format of each capable export.

| file | format | inclusion polygons | inclusion=true (runway buffers) |
|------|--------|---------------------|---------------------------------|
| `mavlink_with_fences.plan` | QGC `.plan` JSON | safety zones + obstacles (`inclusion: false`) | optional |
| `json_with_geozones.json` | TarmacView JSON | `geozones.{safety_zones,obstacles,runway_buffers}` | optional |
| `ugcs_with_zones.json` | UgCS route + customNfzList | safety zones + obstacles | optional |
| `kml_with_keepouts.kml` | KML (advisory) | `<Folder name="Keep-out zones">` placemarks | optional |
| `kmz_with_keepouts.kmz` | DJI WPMZ 1.0.6 archive | `wpmz/template.kml` keep-out folder (advisory) | optional |
