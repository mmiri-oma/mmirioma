"""Order business logic: idempotent creation, references and ownership.

Rules implemented here (docs/api/orders.md):

- **Creation (FR-020, FR-021, FR-027):** a customer's order request is stored
  in status ``quote_requested`` with no price, and an ``order_events`` row
  records the creation (NFR-004).
- **Idempotency (FR-026, NFR-011, T-06):** the client sends one idempotency key
  per checkout attempt. Repeating the key with the same details returns the
  existing order; repeating it with different details is rejected with 409
  ``idempotency_key_reused``. The unique constraint on
  ``(customer_id, idempotency_key)`` makes this hold under concurrent retries.
- **Ownership (FR-001, T-07):** customers read only their own orders. Another
  customer's reference raises the same 404 ``order_not_found`` as a reference
  that does not exist, so references cannot be probed. Staff (admins) read
  every order, with the ordering customer's account.

Callers pass already validated and normalized values (trimmed strings, E.164
phone). Validation belongs to the request schemas.
"""

import secrets
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from http import HTTPStatus

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.modules.auth import service as auth_service
from app.modules.auth.models import User
from app.modules.orders.models import Order, OrderEvent, OrderStatus
from app.shared.lagos_time import lagos_day_start_utc

# Crockford base32: digits and upper-case letters without I, L, O and U, so a
# reference read aloud or copied by hand is hard to get wrong.
REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
REFERENCE_PREFIX = "MO-"
REFERENCE_RANDOM_LENGTH = 10

# Inserts can fail on the unique reference (a 1-in-2^50 collision) or because a
# concurrent retry with the same idempotency key won. Both resolve on retry.
_MAX_CREATE_ATTEMPTS = 3


@dataclass(frozen=True)
class NewOrder:
    """Validated, normalized details of an order request (FR-020).

    Attributes:
        idempotency_key: Client-generated key for this checkout attempt.
        quantity_litres: Requested litres, 1-100000.
        contact_name: Trimmed receiver name.
        contact_phone: Receiver's phone in E.164 form.
        delivery_address: Trimmed free-text address.
        landmark: Optional trimmed landmark.
        delivery_instructions: Optional trimmed instructions.
        preferred_delivery_date: Optional preferred date (Africa/Lagos).
    """

    idempotency_key: uuid.UUID
    quantity_litres: int
    contact_name: str
    contact_phone: str
    delivery_address: str
    landmark: str | None = None
    delivery_instructions: str | None = None
    preferred_delivery_date: date | None = None


def generate_order_reference() -> str:
    """Return a new random, public-safe order reference (FR-027).

    The reference is ``MO-`` plus 10 characters drawn from a cryptographic
    random source, about 50 bits. It is unrelated to the order ID and creation
    time, so it cannot be guessed from other references.

    Returns:
        A reference such as ``MO-7KQ2M9XH4T``.
    """
    random_part = "".join(
        secrets.choice(REFERENCE_ALPHABET) for _ in range(REFERENCE_RANDOM_LENGTH)
    )
    return REFERENCE_PREFIX + random_part


def _order_not_found() -> APIError:
    return APIError(HTTPStatus.NOT_FOUND, "order_not_found", "Order not found")


def _matches_request(order: Order, request: NewOrder) -> bool:
    """Whether a stored order was created from exactly these details."""
    return (
        order.quantity_litres == request.quantity_litres
        and order.contact_name == request.contact_name
        and order.contact_phone == request.contact_phone
        and order.delivery_address == request.delivery_address
        and order.landmark == request.landmark
        and order.delivery_instructions == request.delivery_instructions
        and order.preferred_delivery_date == request.preferred_delivery_date
    )


async def _find_by_idempotency_key(
    session: AsyncSession, customer_id: uuid.UUID, idempotency_key: uuid.UUID
) -> Order | None:
    return await session.scalar(
        select(Order).where(
            Order.customer_id == customer_id, Order.idempotency_key == idempotency_key
        )
    )


# Shown when an earlier send from the same request form was stored
# (docs/design/customer-ordering.md, Decision 9): the client keeps one key per
# form, so a 409 means the request already exists, not that it failed.
IDEMPOTENCY_KEY_REUSED_MESSAGE = (
    "This request was already received. Check your orders before sending it again."
)


def _replay(existing: Order, request: NewOrder) -> tuple[Order, bool]:
    """Resolve a repeated idempotency key (FR-026).

    Raises:
        APIError: 409 ``idempotency_key_reused`` if the details differ.
    """
    if not _matches_request(existing, request):
        raise APIError(
            HTTPStatus.CONFLICT,
            "idempotency_key_reused",
            IDEMPOTENCY_KEY_REUSED_MESSAGE,
        )
    return existing, False


async def create_order(
    session: AsyncSession, *, customer_id: uuid.UUID, request: NewOrder
) -> tuple[Order, bool]:
    """Create a customer's order request, or return the one already created.

    The order starts in ``quote_requested`` with no price (FR-021, FR-022:
    there are no agreed prices in Sprint 1). Its creation is recorded as an
    ``order_events`` row with the customer as actor (NFR-004). Commits.

    Idempotency (FR-026): the existing order for ``(customer_id,
    idempotency_key)`` is looked up first. If two requests with the same key
    race past that lookup, the database's unique constraint rejects the second
    insert, and the retry loop then finds and returns the winner's order.

    Args:
        session: Database session; committed or rolled back here.
        customer_id: The signed-in customer placing the order.
        request: Validated order details.

    Returns:
        ``(order, created)``: ``created`` is False when an earlier submission
        with the same key and details is returned instead.

    Raises:
        APIError: 409 ``idempotency_key_reused`` if the key was already used
            with different details.
        IntegrityError: If inserting still fails after retries (for example the
            customer does not exist).
    """
    for attempt in range(_MAX_CREATE_ATTEMPTS):
        existing = await _find_by_idempotency_key(session, customer_id, request.idempotency_key)
        if existing is not None:
            return _replay(existing, request)

        order = Order(
            id=uuid.uuid4(),
            reference=generate_order_reference(),
            customer_id=customer_id,
            idempotency_key=request.idempotency_key,
            status=OrderStatus.QUOTE_REQUESTED,
            quantity_litres=request.quantity_litres,
            contact_name=request.contact_name,
            contact_phone=request.contact_phone,
            delivery_address=request.delivery_address,
            landmark=request.landmark,
            delivery_instructions=request.delivery_instructions,
            preferred_delivery_date=request.preferred_delivery_date,
        )
        event = OrderEvent(
            order_id=order.id,
            actor_id=customer_id,
            from_status=None,
            to_status=OrderStatus.QUOTE_REQUESTED,
        )
        session.add(order)
        # Flush the order before adding the event so the event's foreign key
        # is satisfied; the two are not linked by an ORM relationship.
        try:
            await session.flush()
            session.add(event)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            if attempt == _MAX_CREATE_ATTEMPTS - 1:
                raise
            continue
        # Load server-generated columns (created_at, updated_at) now, because
        # lazy loading is not available on an AsyncSession.
        await session.refresh(order)
        return order, True
    raise AssertionError("unreachable")  # pragma: no cover


async def get_customer_order(
    session: AsyncSession, *, customer_id: uuid.UUID, reference: str
) -> Order:
    """Return one of the customer's own orders by reference (FR-001).

    Args:
        session: Database session.
        customer_id: The signed-in customer.
        reference: Public order reference.

    Returns:
        The order.

    Raises:
        APIError: 404 ``order_not_found`` if no such order exists **or** it
            belongs to another customer (T-07). The two cases are deliberately
            indistinguishable.
    """
    order = await session.scalar(
        select(Order).where(Order.reference == reference, Order.customer_id == customer_id)
    )
    if order is None:
        raise _order_not_found()
    return order


async def list_customer_orders(
    session: AsyncSession, *, customer_id: uuid.UUID, limit: int, offset: int
) -> tuple[list[Order], int]:
    """Return a page of the customer's own orders, newest first (FR-001).

    Args:
        session: Database session.
        customer_id: The signed-in customer.
        limit: Page size (the caller enforces 1-100).
        offset: Number of orders to skip.

    Returns:
        ``(orders, total)``: the page and the customer's total order count.
    """
    own_orders = Order.customer_id == customer_id
    total = await session.scalar(select(func.count()).select_from(Order).where(own_orders))
    orders = await session.scalars(
        select(Order)
        .where(own_orders)
        # id breaks ties between orders created in the same transaction time,
        # so pages never overlap or skip rows.
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(orders), total or 0


@dataclass(frozen=True)
class StaffOrder:
    """An order together with the account that placed it, for staff views.

    Attributes:
        order: The order.
        customer: The ordering customer's account.
    """

    order: Order
    customer: User


async def _with_customers(session: AsyncSession, orders: Sequence[Order]) -> list[StaffOrder]:
    # Accounts come from the auth module's service rather than a join on its
    # table, keeping modules independent (CLAUDE.md, "Architecture").
    customers = await auth_service.get_users_by_ids(
        session, {order.customer_id for order in orders}
    )
    # customer_id is a RESTRICT foreign key, so every customer exists.
    return [StaffOrder(order=order, customer=customers[order.customer_id]) for order in orders]


async def get_order_for_staff(session: AsyncSession, *, reference: str) -> StaffOrder:
    """Return any order by reference, with its customer (admin view).

    Staff may read every order; the caller enforces the admin role (FR-001).

    Args:
        session: Database session.
        reference: Public order reference.

    Returns:
        The order and its customer.

    Raises:
        APIError: 404 ``order_not_found`` if no order has this reference.
    """
    order = await session.scalar(select(Order).where(Order.reference == reference))
    if order is None:
        raise _order_not_found()
    return (await _with_customers(session, [order]))[0]


async def list_orders_for_staff(
    session: AsyncSession,
    *,
    statuses: Collection[OrderStatus],
    created_from: date | None,
    created_to: date | None,
    is_simulated: bool | None,
    limit: int,
    offset: int,
) -> tuple[list[StaffOrder], int]:
    """Return a filtered page of all orders, newest first (dispatcher queue, FR-030).

    Date filters are inclusive calendar dates in Africa/Lagos (docs/api/README.md):
    ``created_to`` includes the whole of that Lagos day, so the upper bound is
    the start of the next Lagos day, exclusive.

    Args:
        session: Database session.
        statuses: Statuses to include; empty for all.
        created_from: First Lagos creation date to include, or None.
        created_to: Last Lagos creation date to include, or None.
        is_simulated: True for demo records only, False for real orders only,
            None for both (BR-09).
        limit: Page size (the caller enforces 1-100).
        offset: Number of orders to skip.

    Returns:
        ``(orders, total)``: the page with customers, and the count of all
        orders matching the filters.
    """
    conditions: list[ColumnElement[bool]] = []
    if statuses:
        conditions.append(Order.status.in_(set(statuses)))
    if created_from is not None:
        conditions.append(Order.created_at >= lagos_day_start_utc(created_from))
    if created_to is not None:
        conditions.append(Order.created_at < lagos_day_start_utc(created_to + timedelta(days=1)))
    if is_simulated is not None:
        conditions.append(Order.is_simulated.is_(is_simulated))

    total = await session.scalar(select(func.count()).select_from(Order).where(*conditions))
    orders = await session.scalars(
        select(Order)
        .where(*conditions)
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return await _with_customers(session, list(orders)), total or 0
