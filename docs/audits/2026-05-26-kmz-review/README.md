# 2026-05-26 KMZ export review — evidence directory

Per-agent reports from the 20-agent review. Each file is the raw
finding set produced by one read-only audit agent.

**The consolidated audit lives one level up at
`docs/audits/2026-05-26-kmz-export-review.md`** — read that first
for the deduped, prioritised, operator-decided issue list.

These files exist for traceability: every claim in the consolidated
audit cites file:line in one of these reports.

| File | Scope |
|------|-------|
| agent-a1-template-kml.md | template.kml root structure |
| agent-a2-waylines-wpml.md | waylines.wpml root structure |
| agent-a3-mission-config.md | `<wpml:missionConfig>` block |
| agent-a4-placemark.md | `<Placemark>` shape |
| agent-a5-action-groups.md | Action groups |
| agent-a6-kmz-container.md | KMZ container + XML headers |
| agent-b1-enums.md | Drone / payload enums (M4T) |
| agent-b2-altitude.md | Altitude encoding (descent-to-ground) |
| agent-b3-heading.md | Heading modes (yaw smoothness) |
| agent-b4-gimbal.md | Gimbal control (pitch smoothness) |
| agent-b5-payload.md | Payload / camera / lens / focus |
| agent-c1-speed.md | Speed ranges + frame-rate |
| agent-c2-turn-damping.md | Turn modes + damping |
| agent-c3-coordinates.md | Coordinate ordering + precision |
| agent-c4-degenerate.md | Zero-length segments + bookends |
| agent-d1-invariant-test-map.md | Audit-invariant → pinned-test map |
| agent-d2-coverage-matrix.md | Test matrix coverage gaps |
| agent-d3-mocked-tests.md | Over-mocked tests |
| agent-e1-wayline-check-errors.md | WaylineCheckError 25-code coverage |
| agent-e2-msdk-diff.md | DJI MSDK + Pilot 2 reference structural diff |
