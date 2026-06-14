"""unit tests for trajectory helper utilities."""

import pytest

from app.services.trajectory.helpers import _designator_sort_key
from tests.data.trajectory import DESIGNATOR_MAP


class TestDesignatorSortKey:
    """tests for _designator_sort_key ordering."""

    def test_numeric_designators_sort_numerically(self):
        """numeric strings sort by integer value, not lexically."""
        keys = [_designator_sort_key(d) for d in ["10", "2", "1", "3"]]
        labels = ["10", "2", "1", "3"]
        result = [val for _, val in sorted(zip(keys, labels))]
        assert result == ["1", "2", "3", "10"]

    def test_alpha_designators_sort_lexically(self):
        """letter designators sort alphabetically."""
        keys = [_designator_sort_key(d) for d in ["D", "A", "C", "B"]]
        labels = ["D", "A", "C", "B"]
        result = [val for _, val in sorted(zip(keys, labels))]
        assert result == ["A", "B", "C", "D"]

    def test_numeric_before_alpha(self):
        """numeric designators sort before alpha ones."""
        assert _designator_sort_key("1") < _designator_sort_key("A")
        assert _designator_sort_key("99") < _designator_sort_key("A")

    def test_none_treated_as_alpha_empty(self):
        """None designator sorts with alpha group as empty string."""
        key_none = _designator_sort_key(None)
        key_a = _designator_sort_key("A")
        assert key_none < key_a

    @pytest.mark.parametrize("value", [None, ""])
    def test_none_and_empty_equivalent(self, value):
        """None and empty string produce the same sort key."""
        assert _designator_sort_key(value) == _designator_sort_key("")


class TestDesignatorMapConsistency:
    """verify test fixture mapping matches the project's PAPI letter convention."""

    # project convention (per user spec): sequence 1 (furthest from runway) = A,
    # sequence 4 (closest to runway) = D. the letter is a presentation of
    # sequence_number so the invariant 1=A..4=D holds across writes.
    PAPI_MAPPING = {1: "A", 2: "B", 3: "C", 4: "D"}

    def test_fixture_matches_papi_mapping(self):
        """test DESIGNATOR_MAP must match the project's sequence->letter convention."""
        assert DESIGNATOR_MAP == self.PAPI_MAPPING
