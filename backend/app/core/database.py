"""SQLAlchemy engine, session factory, and the request-scoped db dependency."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    """declarative base for all ORM models."""


def get_db():
    """yield a request-scoped session and close it when the request ends."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
