"""shared pytest fixtures: testcontainers postgres session, app test client, stub auth users."""

import os

# pin elevation API fallback OFF for the whole test suite before app imports
# load the Settings - otherwise a developer's local .env (.e.g. with
# ELEVATION_API_FALLBACK_ENABLED=true after #467 rollout) would push every
# position normalization through Open-Elevation, slowing tests by orders of
# magnitude when the API is unreachable. tests that need the API path mock
# httpx.Client or patch the setting locally.
os.environ.setdefault("ELEVATION_API_FALLBACK_ENABLED", "false")

from types import SimpleNamespace  # noqa: E402
from uuid import UUID  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from testcontainers.postgres import PostgresContainer  # noqa: E402

import app.models  # noqa: F401, E402
from app.api.dependencies import get_current_user  # noqa: E402
from app.core.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402

TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000099")
OPERATOR_USER_ID = UUID("00000000-0000-0000-0000-000000000088")
COORDINATOR_USER_ID = UUID("00000000-0000-0000-0000-000000000077")

# stub user for auth bypass in existing tests
_test_user = SimpleNamespace(
    id=TEST_USER_ID,
    email="test@tarmacview.com",
    name="Test User",
    role="SUPER_ADMIN",
    is_active=True,
    airports=[],
)
_test_user.has_airport_access = lambda airport_id: True
_test_user.is_privileged = lambda: _test_user.role in ("COORDINATOR", "SUPER_ADMIN")


def _override_current_user():
    """bypass auth for existing tests - returns super admin stub."""
    return _test_user


def _ensure_test_user_exists(engine):
    """insert the stub test user into the db so FK constraints pass."""
    session = sessionmaker(bind=engine)()
    try:
        existing = session.query(User).filter(User.id == TEST_USER_ID).first()
        if not existing:
            user = User(
                id=TEST_USER_ID,
                email="test@tarmacview.com",
                name="Test User",
                role="SUPER_ADMIN",
                is_active=True,
            )
            user.set_password("testpassword")
            session.add(user)
            session.commit()
    finally:
        session.close()


# shared test database
@pytest.fixture(scope="session")
def db_engine():
    """shared postgres test database"""
    with PostgresContainer(
        image="postgres:16",
        username="test",
        password="test",
        dbname="test",
    ) as pg:
        engine = create_engine(pg.get_connection_url())

        Base.metadata.create_all(engine)
        _ensure_test_user_exists(engine)
        yield engine
        Base.metadata.drop_all(engine)


# shared test client
@pytest.fixture(scope="session")
def client(db_engine):
    """shared test client with db and auth overrides"""
    TestSession = sessionmaker(bind=db_engine)

    def override_get_db():
        """test db override."""
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = _override_current_user
    yield TestClient(app)
    app.dependency_overrides.clear()


# per-test db session with rollback
@pytest.fixture
def db_session(db_engine):
    """per-test db session"""
    session = sessionmaker(bind=db_engine)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _clear_runtime_settings_cache():
    """drop the in-process runtime_settings cache between tests.

    `runtime_settings._CACHE` is module-level state. without this fixture a
    test that populates the cache (PUT /admin/system-settings sets it to
    True) could leak into a later test that expects a fresh DB read. tests
    that need a hot cache repopulate via the route or the public api.
    """
    from app.services import runtime_settings

    runtime_settings.invalidate()
    yield
    runtime_settings.invalidate()


@pytest.fixture
def as_operator(db_engine):
    """context-manager factory that swaps auth to a non-owner OPERATOR user.

    FastAPI's dependency_overrides is global, so a plain "operator_client"
    fixture would poison requests made through the default `client` fixture
    for the duration of the test. Using a context manager scopes the override
    strictly to the `with` block: setup/teardown through the super-admin
    `client`, and assertions on ownership through the scoped operator client.

    usage:
        def test_foo(client, as_operator):
            preset_id = client.post(...).json()["id"]
            with as_operator() as op_client:
                assert op_client.get(...).status_code == 404
    """
    from contextlib import contextmanager

    session = sessionmaker(bind=db_engine)()
    try:
        existing = session.query(User).filter(User.id == OPERATOR_USER_ID).first()
        if not existing:
            user = User(
                id=OPERATOR_USER_ID,
                email="operator@tarmacview.com",
                name="Operator B",
                role="OPERATOR",
                is_active=True,
            )
            user.set_password("testpassword")
            session.add(user)
            session.commit()
    finally:
        session.close()

    operator_stub = SimpleNamespace(
        id=OPERATOR_USER_ID,
        email="operator@tarmacview.com",
        name="Operator B",
        role="OPERATOR",
        is_active=True,
        airports=[],
    )
    operator_stub.has_airport_access = lambda airport_id: True
    operator_stub.is_privileged = lambda: operator_stub.role in ("COORDINATOR", "SUPER_ADMIN")

    TestSession = sessionmaker(bind=db_engine)

    def override_db():
        """test db override."""
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def _as_operator():
        saved = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: operator_stub
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(saved)

    return _as_operator


@pytest.fixture
def as_coordinator(db_engine):
    """context-manager factory that swaps auth to a COORDINATOR user.

    mirrors `as_operator` so route tests can exercise the coordinator-only
    branches (e.g. the auto-assign ASSIGN_AIRPORT audit row on airport create).
    the stub id/email match a real db row so audit-log FK inserts succeed.
    """
    from contextlib import contextmanager

    session = sessionmaker(bind=db_engine)()
    try:
        existing = session.query(User).filter(User.id == COORDINATOR_USER_ID).first()
        if not existing:
            user = User(
                id=COORDINATOR_USER_ID,
                email="coordinator@tarmacview.com",
                name="Coordinator C",
                role="COORDINATOR",
                is_active=True,
            )
            user.set_password("testpassword")
            session.add(user)
            session.commit()
    finally:
        session.close()

    coordinator_stub = SimpleNamespace(
        id=COORDINATOR_USER_ID,
        email="coordinator@tarmacview.com",
        name="Coordinator C",
        role="COORDINATOR",
        is_active=True,
        airports=[],
    )
    coordinator_stub.has_airport_access = lambda airport_id: True
    coordinator_stub.is_privileged = lambda: True

    TestSession = sessionmaker(bind=db_engine)

    def override_db():
        """test db override."""
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def _as_coordinator():
        saved = dict(app.dependency_overrides)
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: coordinator_stub
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(saved)

    return _as_coordinator
