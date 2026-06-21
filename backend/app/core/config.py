"""application settings and derived runtime defaults."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.constants import DEFAULT_BUFFER_DISTANCE_M

DEFAULT_JWT_SECRET = "change-me-in-production-minimum-256-bits"

# project root - resolved once for default paths
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    """application settings loaded from environment."""

    database_url: str = "postgresql://tarmacview:tarmacview@localhost:5432/tarmacview"
    # overridden via .env in production
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_expiration_minutes: int = 15
    jwt_refresh_expiration_days: int = 7
    cors_origins: list[str] = ["http://localhost:5173"]

    # safety constants - overridable via .env. vertex_buffer_m is the env-override
    # seam for DEFAULT_BUFFER_DISTANCE_M, kept aliased to it so the two cannot
    # drift apart at runtime.
    takeoff_safe_altitude: float = 10.0
    landing_safe_altitude: float = 10.0
    vertex_buffer_m: float = DEFAULT_BUFFER_DISTANCE_M

    # terrain settings
    terrain_dir: Path = _PROJECT_ROOT / "data" / "terrain"
    terrain_download_timeout: float = 300.0  # 5 min total wall-clock limit
    terrain_grid_delta_deg: float = 0.045  # ~5km bounding box half-width
    terrain_grid_step_deg: float = 0.00027  # ~30m grid spacing
    terrain_api_batch_size: int = 2000  # max points per API request
    open_elevation_url: str = "https://api.open-elevation.com/api/v1/lookup"
    # public AWS Open Data bucket for Copernicus GLO-30 (30m) DEM COGs, no login.
    # overridable for closed-network mirrors, mirrors open_elevation_url.
    copernicus_dem_base_url: str = "https://copernicus-dem-30m.s3.amazonaws.com"

    # per-point elevation API fallback. disabled by default so test
    # runs don't depend on outbound network; production deployments enable via env.
    elevation_api_fallback_enabled: bool = False
    elevation_api_lookup_timeout: float = 2.0

    # deployment environment
    environment: str = "development"

    # user seeding - opt-in via env var
    seed_users: bool = False
    seed_admin_email: str = "admin@tmv.com"
    seed_admin_password: str = "adminadmin"
    seed_coordinator_email: str = "coord@tmv.com"
    seed_coordinator_password: str = "coordinator"
    seed_operator_email: str = "operator@tmv.com"
    seed_operator_password: str = "operator"

    # refresh token cookie settings
    refresh_cookie_name: str = "tarmacview_refresh"
    refresh_cookie_secure: bool = False
    refresh_cookie_domain: str | None = None

    # jwt algorithm
    jwt_algorithm: str = "HS256"

    # openaip integration
    openaip_api_url: str = "https://api.core.openaip.net/api"
    openaip_api_key: str = ""
    openaip_request_timeout: float = 30.0

    # admin invitation token lifetime
    invitation_expiry_hours: int = 72

    # field hub proxy - empty url means no hub in this deployment
    fieldhub_url: str = ""
    fieldhub_shared_secret: str = ""
    fieldhub_ca: str = ""
    fieldhub_timeout: float = 3.0

    # object storage for drone media + result artifacts. s3_endpoint_url empty =
    # real AWS S3; otherwise the compose minio (http://minio:9000). presigned
    # urls are signed against s3_public_endpoint so a browser on the host/LAN can
    # reach the bucket directly (mirrors the field-hub minio public-endpoint split).
    s3_endpoint_url: str = ""
    s3_public_endpoint: str = ""
    s3_bucket: str = "tarmacview-media"
    # dedicated bucket for scheduled db backups - kept separate from media artifacts
    s3_backup_bucket: str = "tarmacview-backups"
    s3_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    # presigned url lifetime in seconds
    s3_presign_expiry: int = 3600

    # offline base-map tiles. air-gapped field deployments serve raster tiles from a
    # minio-stored mbtiles bundle, then a disk cache, then (when allowed) an upstream cdn.
    # tile_mode governs whether the upstream tier runs: offline never reaches the network.
    tile_mode: str = "online"  # online | cached | offline
    # bundle object key in s3_bucket is "{tile_bundle_prefix}/{layer}.mbtiles"
    tile_bundle_prefix: str = "basemaps"
    tile_cache_dir: Path = _PROJECT_ROOT / "data" / "tile-cache"
    tile_cache_max_bytes: int = 512 * 1024 * 1024  # 512 MB, proxied tiles only
    tile_cache_max_age_days: int = 7  # matches the browser sw cache-tier policy
    tile_upstream_timeout: float = 10.0
    # keys define the valid {layer} set; values are the upstream cdn templates used by
    # tier 3. {z}/{x}/{y} substituted in any path order (esri z/y/x, osm z/x/y both work).
    tile_upstream_urls: dict[str, str] = {
        "imagery": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "osm": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "reference": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    }

    # fernet symmetric encryption key for admin-managed secrets at rest.
    # accepts a 32-byte urlsafe-b64 fernet key or any string (sha256-derived).
    # required when SystemSettings stores an api key; unset -> startup hard-fail
    # on first encrypt/decrypt call so plaintext is never silently persisted.
    secret_encryption_key: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


def _check_jwt_secret(s: "Settings") -> None:
    """raise in production when jwt_secret is the built-in default; warn otherwise."""
    if s.jwt_secret != DEFAULT_JWT_SECRET:
        return

    if s.environment == "production":
        raise RuntimeError(
            "jwt_secret is using the built-in default in production - "
            "set JWT_SECRET env var to a secure value"
        )

    import logging as _log

    _log.getLogger(__name__).warning(
        "jwt_secret is using the built-in default - set JWT_SECRET env var in production"
    )


settings = Settings()
_check_jwt_secret(settings)

# backwards-compatible alias
TERRAIN_DIR = settings.terrain_dir
