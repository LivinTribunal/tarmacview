"""object storage - presigned PUT/GET against the s3-compatible media bucket."""

from app.core.config import settings


def _client(*, public: bool):
    """build an s3 client - public uses the browser-reachable endpoint for signing.

    server-side calls use the internal endpoint; presigned urls handed to the
    browser are signed against s3_public_endpoint so the host/LAN can reach the
    bucket directly. sigv4 signs the host, so the url must be generated against
    the endpoint the browser actually hits - rewriting the host post-sign would
    break the signature.

    boto3 is imported lazily so the module (and the whole app) still imports on
    a backend that pins only requirements.txt - boto3 ships in requirements-video.txt
    and is needed only when an upload url is actually minted.
    """
    import boto3
    from botocore.config import Config

    if public:
        endpoint = settings.s3_public_endpoint or settings.s3_endpoint_url
    else:
        endpoint = settings.s3_endpoint_url
    return boto3.client(
        "s3",
        endpoint_url=endpoint or None,
        region_name=settings.s3_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        config=Config(signature_version="s3v4"),
    )


def presigned_put(object_key: str, content_type: str | None = None) -> str:
    """presigned PUT url for a browser to upload one object directly."""
    params = {"Bucket": settings.s3_bucket, "Key": object_key}
    if content_type:
        params["ContentType"] = content_type
    return _client(public=True).generate_presigned_url(
        "put_object", Params=params, ExpiresIn=settings.s3_presign_expiry
    )


def presigned_get(object_key: str) -> str:
    """presigned GET url for retrieving one stored object."""
    return _client(public=True).generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": object_key},
        ExpiresIn=settings.s3_presign_expiry,
    )
