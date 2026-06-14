"""admin user management: lifecycle + airport assignments + admin-overview airport list.

system-settings helpers live in `admin_settings.py` and are re-exported from
this module so legacy imports (`from app.services.admin_service import
SETTINGS_DEFAULTS / is_maintenance_mode / get_system_settings /
update_system_settings`) continue to resolve unchanged.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.enums import UserRole
from app.core.exceptions import ConflictError, DomainError, NotFoundError
from app.models.airport import Airport
from app.models.user import User, user_airports
from app.services.admin_settings import (
    SETTINGS_DEFAULTS,
    _collect_setting_updates,
    _get_setting,
    _upsert_settings,
    get_system_settings,
    is_maintenance_mode,
    update_system_settings,
)

__all__ = [
    "list_users",
    "get_user",
    "invite_user",
    "update_user",
    "deactivate_user",
    "activate_user",
    "delete_user",
    "reset_password",
    "update_airport_assignments",
    "list_airports_admin",
    "SETTINGS_DEFAULTS",
    "get_system_settings",
    "update_system_settings",
    "is_maintenance_mode",
    "_get_setting",
    "_collect_setting_updates",
    "_upsert_settings",
]


# self/last-super-admin guards


def _assert_not_self(actor_id: UUID, target_id: UUID, action: str) -> None:
    """refuse privileged actions an admin runs against their own account."""
    if actor_id == target_id:
        raise DomainError(f"cannot {action} your own account")


def _assert_not_last_super_admin(db: Session, target: User) -> None:
    """refuse changes that would leave zero active super admins."""
    if target.role != UserRole.SUPER_ADMIN.value or not target.is_active:
        return
    remaining = (
        db.query(User)
        .filter(
            User.role == UserRole.SUPER_ADMIN.value,
            User.is_active.is_(True),
            User.id != target.id,
        )
        .count()
    )
    if remaining == 0:
        raise DomainError("cannot remove the last active super admin")


def list_users(
    db: Session,
    role: str | None = None,
    is_active: bool | None = None,
    airport_id: UUID | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[User], int]:
    """list users with optional filters."""
    base = db.query(User)

    if role:
        base = base.filter(User.role == role)
    if is_active is not None:
        base = base.filter(User.is_active == is_active)
    if airport_id:
        base = base.filter(User.airports.any(Airport.id == airport_id))
    if search:
        pattern = f"%{search}%"
        base = base.filter((User.name.ilike(pattern)) | (User.email.ilike(pattern)))

    # count on base query without joinedload to avoid row inflation
    total = base.count()
    users = (
        base.options(joinedload(User.airports))
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return users, total


def get_user(db: Session, user_id: UUID) -> User:
    """get user by id with airports loaded."""
    user = db.query(User).options(joinedload(User.airports)).filter(User.id == user_id).first()
    if not user:
        raise NotFoundError("user not found")
    return user


def invite_user(
    db: Session,
    email: str,
    name: str,
    role: str,
    airport_ids: list[UUID],
) -> tuple[User, str]:
    """create inactive user with invitation token, return user and token."""
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise ConflictError("user with this email already exists")

    valid_roles = [r.value for r in UserRole]
    if role not in valid_roles:
        raise DomainError(f"invalid role: {role}")

    token = str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.invitation_expiry_hours)
    # is_active=True at invite so setup_password's is_active guard does not
    # block legitimate first-time setup; login still fails until the user
    # completes setup (verify_password returns false on null hash)
    user = User(
        email=email,
        name=name,
        role=role,
        is_active=True,
        invitation_token=token,
        invitation_expires_at=expires_at,
    )

    if airport_ids:
        airports = db.query(Airport).filter(Airport.id.in_(airport_ids)).all()
        user.airports = airports

    db.add(user)
    db.flush()
    db.refresh(user)
    return user, token


def update_user(
    db: Session,
    actor_id: UUID,
    user_id: UUID,
    name: str | None,
    email: str | None,
    role: str | None,
) -> User:
    """update user fields."""
    user = get_user(db, user_id)

    if email and email != user.email:
        existing = db.query(User).filter(User.email == email, User.id != user_id).first()
        if existing:
            raise ConflictError("email already in use")
        user.email = email

    if name is not None:
        user.name = name

    if role is not None:
        valid_roles = [r.value for r in UserRole]
        if role not in valid_roles:
            raise DomainError(f"invalid role: {role}")
        # role change is the only update that can lock out the system
        if role != user.role:
            _assert_not_self(actor_id, user.id, "change the role of")
            if user.role == UserRole.SUPER_ADMIN.value and role != UserRole.SUPER_ADMIN.value:
                _assert_not_last_super_admin(db, user)
        user.role = role

    db.flush()
    db.refresh(user)
    return user


def deactivate_user(db: Session, actor_id: UUID, user_id: UUID) -> User:
    """soft deactivate user; revokes any outstanding invitation link."""
    user = get_user(db, user_id)
    _assert_not_self(actor_id, user.id, "deactivate")
    _assert_not_last_super_admin(db, user)
    user.is_active = False
    user.invitation_token = None
    user.invitation_expires_at = None
    db.flush()
    db.refresh(user)
    return user


def activate_user(db: Session, user_id: UUID) -> User:
    """reactivate user."""
    user = get_user(db, user_id)
    user.is_active = True
    db.flush()
    db.refresh(user)
    return user


def delete_user(db: Session, actor_id: UUID, user: User) -> None:
    """hard delete - only allowed for inactive users."""
    _assert_not_self(actor_id, user.id, "delete")
    if user.is_active:
        raise DomainError("can only delete inactive users")
    db.delete(user)
    db.flush()


def reset_password(db: Session, user_id: UUID) -> str:
    """generate new invitation token for password reset."""
    user = get_user(db, user_id)
    if not user.is_active:
        raise DomainError("account is deactivated", status_code=403)
    token = str(uuid4())
    user.invitation_token = token
    user.invitation_expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.invitation_expiry_hours
    )
    db.flush()
    return token


def update_airport_assignments(db: Session, user_id: UUID, airport_ids: list[UUID]) -> User:
    """replace user airport assignments."""
    user = get_user(db, user_id)
    airports = db.query(Airport).filter(Airport.id.in_(airport_ids)).all() if airport_ids else []
    user.airports = airports
    db.flush()
    db.refresh(user)
    return user


def _airport_count_subqueries(db: Session):
    """build the 5 per-airport count subqueries (user/coordinator/operator/mission/drone)."""
    from app.models.mission import Mission

    user_counts = (
        db.query(
            user_airports.c.airport_id,
            func.count().label("user_count"),
        )
        .group_by(user_airports.c.airport_id)
        .subquery()
    )

    coordinator_counts = (
        db.query(
            user_airports.c.airport_id,
            func.count().label("coordinator_count"),
        )
        .join(User, User.id == user_airports.c.user_id)
        .filter(User.role == UserRole.COORDINATOR.value)
        .group_by(user_airports.c.airport_id)
        .subquery()
    )

    operator_counts = (
        db.query(
            user_airports.c.airport_id,
            func.count().label("operator_count"),
        )
        .join(User, User.id == user_airports.c.user_id)
        .filter(User.role == UserRole.OPERATOR.value)
        .group_by(user_airports.c.airport_id)
        .subquery()
    )

    mission_counts = (
        db.query(
            Mission.airport_id,
            func.count().label("mission_count"),
        )
        .group_by(Mission.airport_id)
        .subquery()
    )

    drone_counts = (
        db.query(
            Mission.airport_id,
            func.count(func.distinct(Mission.drone_profile_id)).label("drone_count"),
        )
        .filter(Mission.drone_profile_id.isnot(None))
        .group_by(Mission.airport_id)
        .subquery()
    )

    return user_counts, coordinator_counts, operator_counts, mission_counts, drone_counts


def list_airports_admin(
    db: Session,
    search: str | None = None,
    country: str | None = None,
) -> list[dict]:
    """list airports with user/coordinator/operator/mission/drone counts for admin overview."""
    # subquery aggregates - single round-trip instead of 5N+1
    (
        user_counts,
        coordinator_counts,
        operator_counts,
        mission_counts,
        drone_counts,
    ) = _airport_count_subqueries(db)

    query = (
        db.query(
            Airport,
            func.coalesce(user_counts.c.user_count, 0).label("user_count"),
            func.coalesce(coordinator_counts.c.coordinator_count, 0).label("coordinator_count"),
            func.coalesce(operator_counts.c.operator_count, 0).label("operator_count"),
            func.coalesce(mission_counts.c.mission_count, 0).label("mission_count"),
            func.coalesce(drone_counts.c.drone_count, 0).label("drone_count"),
        )
        .outerjoin(user_counts, Airport.id == user_counts.c.airport_id)
        .outerjoin(coordinator_counts, Airport.id == coordinator_counts.c.airport_id)
        .outerjoin(operator_counts, Airport.id == operator_counts.c.airport_id)
        .outerjoin(mission_counts, Airport.id == mission_counts.c.airport_id)
        .outerjoin(drone_counts, Airport.id == drone_counts.c.airport_id)
    )

    if search:
        pattern = f"%{search.lower()}%"
        query = query.filter(
            func.lower(Airport.name).like(pattern)
            | func.lower(Airport.icao_code).like(pattern)
            | func.lower(Airport.city).like(pattern)
        )

    if country:
        query = query.filter(func.lower(Airport.country) == country.lower())

    rows = query.all()

    return [
        {
            "id": airport.id,
            "icao_code": airport.icao_code,
            "name": airport.name,
            "city": airport.city,
            "country": airport.country,
            "user_count": uc,
            "coordinator_count": cc,
            "operator_count": oc,
            "mission_count": mc,
            "drone_count": dc,
            "terrain_source": airport.terrain_source,
            "created_at": None,
        }
        for airport, uc, cc, oc, mc, dc in rows
    ]
