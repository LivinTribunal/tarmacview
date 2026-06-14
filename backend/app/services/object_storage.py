"""object storage - presigned PUT/GET against the s3-compatible media bucket."""

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


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


def delete_object(object_key: str) -> None:
    """best-effort delete of one stored object - an orphan never blocks the caller."""
    try:
        _client(public=False).delete_object(Bucket=settings.s3_bucket, Key=object_key)
    except Exception:
        logger.warning("failed to delete object %s from bucket", object_key, exc_info=True)


# server-side put/get - the worker writes result artifacts and reads inputs over the
# internal endpoint (no presigning; the worker reaches the bucket directly).


def put_object(object_key: str, body: bytes, content_type: str | None = None) -> None:
    """upload raw bytes to the bucket (gzipped results json, small artifacts)."""
    extra = {"ContentType": content_type} if content_type else {}
    _client(public=False).put_object(Bucket=settings.s3_bucket, Key=object_key, Body=body, **extra)


def get_object(object_key: str) -> bytes:
    """download one stored object's bytes."""
    resp = _client(public=False).get_object(Bucket=settings.s3_bucket, Key=object_key)
    return resp["Body"].read()


def upload_file(object_key: str, file_path: str, content_type: str | None = None) -> None:
    """upload a local file to the bucket (annotated videos, first-frame image)."""
    extra = {"ContentType": content_type} if content_type else {}
    _client(public=False).upload_file(
        file_path, settings.s3_bucket, object_key, ExtraArgs=extra or None
    )


def download_file(object_key: str, dest_path: str) -> None:
    """download one stored object to a local path (input videos for the engine)."""
    _client(public=False).download_file(settings.s3_bucket, object_key, dest_path)
