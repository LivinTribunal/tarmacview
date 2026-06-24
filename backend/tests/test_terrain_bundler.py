"""tests for the offline terrain bundler (scripts/field-hub/bundle-terrain.py).

the bundler is a standalone script outside the backend package; it is loaded
here by file path so its pure ctb-argv assembly can be unit tested without
spawning Cesium Terrain Builder (the build pass itself is not exercised in CI).
"""

import importlib.util
from pathlib import Path

_BUNDLER_PATH = Path(__file__).resolve().parents[2] / "scripts" / "field-hub" / "bundle-terrain.py"


def _load_bundler():
    """import the hyphenated bundle-terrain.py module by file path."""
    spec = importlib.util.spec_from_file_location("bundle_terrain", _BUNDLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bundler = _load_bundler()


class TestBuildCtbCommand:
    """pure ctb-tile argv assembly for the docker / native + tile / layer passes."""

    def test_docker_tile_pass_argv(self, tmp_path):
        """docker tile pass mounts dem + out, runs ctb-tile -f Mesh, ends with the dem path."""
        dem = tmp_path / "dem" / "prague.tif"
        out = tmp_path / "out"
        cmd = bundler.build_ctb_command(
            dem,
            out,
            layer_only=False,
            start_zoom=None,
            end_zoom=None,
            use_docker=True,
            ctb_image="img",
        )
        assert cmd[:3] == ["docker", "run", "--rm"]
        assert f"{dem.parent.resolve()}:/dem:ro" in cmd
        assert f"{out.resolve()}:/out" in cmd
        assert "img" in cmd
        assert cmd[cmd.index("ctb-tile") : cmd.index("ctb-tile") + 5] == [
            "ctb-tile",
            "-f",
            "Mesh",
            "-o",
            "/out",
        ]
        assert cmd[-1] == "/dem/prague.tif"
        assert "-l" not in cmd

    def test_docker_layer_pass_includes_l(self, tmp_path):
        """the layer.json pass appends -l."""
        cmd = bundler.build_ctb_command(
            tmp_path / "dem.tif",
            tmp_path / "out",
            layer_only=True,
            start_zoom=None,
            end_zoom=None,
            use_docker=True,
            ctb_image="img",
        )
        assert "-l" in cmd

    def test_native_pass_has_no_docker_prefix(self, tmp_path):
        """--no-docker uses local string paths and no docker/-v prefix."""
        dem = tmp_path / "dem.tif"
        out = tmp_path / "out"
        cmd = bundler.build_ctb_command(
            dem,
            out,
            layer_only=False,
            start_zoom=None,
            end_zoom=None,
            use_docker=False,
            ctb_image="img",
        )
        assert "docker" not in cmd
        assert "-v" not in cmd
        assert cmd[0] == "ctb-tile"
        assert cmd[cmd.index("-o") + 1] == str(out)
        assert cmd[-1] == str(dem)

    def test_zoom_flags_appended_and_omitted(self, tmp_path):
        """start/end zoom produce -s N / -e N; both None omit the flags."""
        cmd = bundler.build_ctb_command(
            tmp_path / "dem.tif",
            tmp_path / "out",
            layer_only=False,
            start_zoom=0,
            end_zoom=14,
            use_docker=False,
            ctb_image="img",
        )
        assert cmd[cmd.index("-s") + 1] == "0"
        assert cmd[cmd.index("-e") + 1] == "14"

        bare = bundler.build_ctb_command(
            tmp_path / "dem.tif",
            tmp_path / "out",
            layer_only=False,
            start_zoom=None,
            end_zoom=None,
            use_docker=False,
            ctb_image="img",
        )
        assert "-s" not in bare
        assert "-e" not in bare


def test_main_missing_dem_returns_1(tmp_path):
    """a missing DEM exits 1 without spawning ctb."""
    assert bundler.main(["--dem", str(tmp_path / "nope.tif"), "--out", str(tmp_path / "o")]) == 1
