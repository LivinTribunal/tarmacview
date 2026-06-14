"""unit tests for the litchi collocated-waypoint merge (_group_collocated)."""

from app.services.export.formats.litchi import (
    _LITCHI_MIN_3D_DIST,
    _dist_3d,
    _group_collocated,
    _rec_pos,
)

# fixed (lon, lat) and a 0.0 altitude base so the 3d distance between records
# is exactly the altitude delta in metres - no projection or rounding error
# in the boundary assertions
_LON = 14.26
_LAT = 50.1


def _rec(tag: str, alt: float) -> tuple:
    """fake (wp, lon, lat, alt, agl) record varying altitude only."""
    return (tag, _LON, _LAT, alt, alt)


def _reps(groups: list) -> list:
    """tag of each group's representative (first member)."""
    return [grp[0][0] for grp in groups]


class TestGroupCollocated:
    """tests for the two-pass collocation merge behind the litchi csv export."""

    def test_empty_input_passes_through(self):
        """no records yields no groups."""
        assert _group_collocated([]) == []

    def test_single_record_passes_through(self):
        """one record yields one single-member group."""
        rec = _rec("only", 300.0)
        assert _group_collocated([rec]) == [[rec]]

    def test_gap_just_below_floor_merges(self):
        """0.59 m apart is under the floor - records merge into one group."""
        records = [_rec("a", 0.0), _rec("b", 0.59)]
        groups = _group_collocated(records)
        assert groups == [records]

    def test_gap_exactly_at_floor_stays_separate(self):
        """0.60 m apart is not under the strict < floor - two groups."""
        records = [_rec("a", 0.0), _rec("b", _LITCHI_MIN_3D_DIST)]
        groups = _group_collocated(records)
        assert groups == [[records[0]], [records[1]]]

    def test_gap_just_above_floor_stays_separate(self):
        """0.61 m apart keeps both records as their own groups."""
        records = [_rec("a", 0.0), _rec("b", 0.61)]
        groups = _group_collocated(records)
        assert groups == [[records[0]], [records[1]]]

    def test_all_collocated_yields_one_group_in_input_order(self):
        """identical positions collapse to one group preserving input order."""
        records = [_rec(f"r{i}", 300.0) for i in range(5)]
        groups = _group_collocated(records)
        assert len(groups) == 1
        assert [member[0] for member in groups[0]] == ["r0", "r1", "r2", "r3", "r4"]

    def test_first_occurrence_order_of_reps_preserved(self):
        """group representatives appear in first-occurrence input order."""
        records = [
            _rec("a1", 300.0),
            _rec("a2", 300.1),
            _rec("b1", 310.0),
            _rec("c1", 320.0),
            _rec("c2", 320.2),
        ]
        groups = _group_collocated(records)
        assert _reps(groups) == ["a1", "b1", "c1"]
        assert [len(grp) for grp in groups] == [2, 1, 2]

    def test_merge_is_rep_anchored_not_chained(self):
        """a record near the previous member but not the rep starts a new group."""
        # r1 is 0.5 m from rep r0 (merges); r2 is 0.5 m from r1 but 1.0 m
        # from rep r0, so it anchors a new group instead of chaining on
        records = [_rec("r0", 0.0), _rec("r1", 0.5), _rec("r2", 1.0)]
        groups = _group_collocated(records)
        assert _reps(groups) == ["r0", "r2"]
        assert [member[0] for member in groups[0]] == ["r0", "r1"]

    def test_adjacent_reps_respect_floor_after_merge(self):
        """defensive-second-pass invariant: adjacent output reps are >= the floor apart."""
        # dense 0.31 m ladder - pass 1 merges pairs, leaving reps 0.62 m
        # apart, so the second pass finds nothing left to merge
        records = [_rec(f"r{i}", i * 0.31) for i in range(8)]
        groups = _group_collocated(records)
        assert _reps(groups) == ["r0", "r2", "r4", "r6"]
        for prev, cur in zip(groups, groups[1:]):
            assert _dist_3d(_rec_pos(prev[0]), _rec_pos(cur[0])) >= _LITCHI_MIN_3D_DIST
