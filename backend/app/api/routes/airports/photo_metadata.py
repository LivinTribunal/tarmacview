"""extract GPS position metadata from uploaded drone photos - read-only, no DB writes."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, check_airport_access
from app.core.dependencies import get_db
from app.core.exceptions import DomainError, NotFoundError
from app.schemas.airport import PhotoMetadataResponse
from app.services import photo_metadata_service

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_PHOTOS = 50
MAX_PHOTO_SIZE = 50 * 1024 * 1024  # 50MB per image


@router.post("/{airport_id}/extract-photo-metadata", response_model=PhotoMetadataResponse)
def extract_photo_metadata(
    airport_id: UUID,
    files: list[UploadFile],
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """extract per-image GPS coordinates + PAPI lens height from EXIF/XMP. read-only."""
    check_airport_access(current_user, airport_id)

    if not files:
        raise HTTPException(status_code=400, detail="no images provided")
    if len(files) > MAX_PHOTOS:
        raise HTTPException(status_code=400, detail=f"too many images (max {MAX_PHOTOS})")

    # read each upload into memory enforcing the per-image cap; the extractor only
    # needs the raw bytes (EXIF + XMP live in the file header)
    photos: list[tuple[str, bytes]] = []
    for f in files:
        raw = f.file.read(MAX_PHOTO_SIZE + 1)
        if len(raw) > MAX_PHOTO_SIZE:
            raise HTTPException(status_code=400, detail="image exceeds 50MB limit")
        photos.append((f.filename or "image", raw))

    try:
        return photo_metadata_service.extract_photo_metadata(db, airport_id, photos)
    except (NotFoundError, DomainError) as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
