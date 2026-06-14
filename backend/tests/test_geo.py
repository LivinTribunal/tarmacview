"""unit tests for the convex-hull / OBB helpers extracted from geo.py."""

import math

from app.utils.geo import _convex_hull, _min_area_obb, polygon_oriented_dimensions


class TestConvexHull:
    """Andrew's monotone-chain hull behavior."""

    def test_square_returns_four_corners(self):
        """axis-aligned square hull is its four corners."""
        pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
        hull = _convex_hull(pts)
        assert len(hull) == 4
        assert set(hull) == set(pts)

    def test_interior_point_dropped(self):
        """a point strictly inside the square is not on the hull."""
        pts = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (5.0, 5.0)]
        hull = _convex_hull(pts)
        assert (5.0, 5.0) not in hull
        assert len(hull) == 4

    def test_collinear_points_degenerate(self):
        """collinear points cannot form a 3+ vertex hull."""
        pts = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)]
        assert len(_convex_hull(pts)) < 3

    def test_two_distinct_points_yield_empty_hull(self):
        """duplicate points collapse; < 3 distinct yields an empty hull."""
        pts = [(0.0, 0.0), (0.0, 0.0), (1.0, 1.0), (1.0, 1.0)]
        assert _convex_hull(pts) == []

    def test_duplicates_do_not_inflate_square_hull(self):
        """repeated corners still yield a four-vertex square hull."""
        pts = [
            (0.0, 0.0),
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 10.0),
            (10.0, 10.0),
            (0.0, 10.0),
        ]
        assert len(_convex_hull(pts)) == 4


class TestMinAreaObb:
    """rotating-calipers minimum-area bounding box."""

    def test_axis_aligned_rectangle(self):
        """100x40 axis-aligned rect: length 100, width 40, east-west heading."""
        hull = _convex_hull([(0.0, 0.0), (100.0, 0.0), (100.0, 40.0), (0.0, 40.0)])
        length, width, heading = _min_area_obb(hull)
        assert math.isclose(length, 100.0, abs_tol=1e-6)
        assert math.isclose(width, 40.0, abs_tol=1e-6)
        assert math.isclose(heading, 90.0, abs_tol=1e-6)

    def test_rotated_45_rectangle(self):
        """4x2 rectangle rotated 45 deg: length 4, width 2, heading 45 deg."""
        h = math.sqrt(0.5)  # unit step along the rotated axes
        hull = _convex_hull(
            [
                (2 * h - h, 2 * h + h),
                (2 * h + h, 2 * h - h),
                (-2 * h - h, -2 * h + h),
                (-2 * h + h, -2 * h - h),
            ]
        )
        length, width, heading = _min_area_obb(hull)
        assert math.isclose(length, 4.0, abs_tol=1e-6)
        assert math.isclose(width, 2.0, abs_tol=1e-6)
        assert math.isclose(heading % 180.0, 45.0, abs_tol=1e-6)


class TestPolygonOrientedDimensionsParity:
    """public entrypoint preserves its pre-extraction contract."""

    def test_fewer_than_three_points(self):
        """a 2-point ring has no box."""
        assert polygon_oriented_dimensions([[14.26, 50.10], [14.27, 50.10]]) == (
            0.0,
            0.0,
            0.0,
        )

    def test_closed_ring_matches_open_ring(self):
        """a closed ring yields the same box as the same ring left open."""
        open_ring = [
            [14.260, 50.100, 0.0],
            [14.270, 50.100, 0.0],
            [14.270, 50.104, 0.0],
            [14.260, 50.104, 0.0],
        ]
        closed_ring = open_ring + [open_ring[0]]
        assert polygon_oriented_dimensions(closed_ring) == polygon_oriented_dimensions(open_ring)

    def test_closed_ring_nontrivial(self):
        """a real rectangle ring produces a positive length > width."""
        ring = [
            [14.260, 50.100, 0.0],
            [14.270, 50.100, 0.0],
            [14.270, 50.104, 0.0],
            [14.260, 50.104, 0.0],
            [14.260, 50.100, 0.0],
        ]
        length, width, _ = polygon_oriented_dimensions(ring)
        assert length > width > 0.0
