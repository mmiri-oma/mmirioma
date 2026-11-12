"""Order confirmation for the pilot (docs/api/deliveries.md, "Order confirmation endpoints").

Agreed G3 on 2026-10-22 (PR #111) from the approved order confirmation design
(#87). A dispatcher phones the customer, agrees a **manual quote** (pilot
fallback F2) and a **delivery window** (F3), chooses a **water category** and
an **eligible source** (F1, FR-012), and confirms. Every pilot order is pay on
delivery (F4) and has no cancellation or redelivery charge (F5).

**Quoted orders** (#21, question 14 of docs/api/order-details-and-price.md):
an order placed with a server quote is already ``awaiting_confirmation``
(row 3). The dispatcher confirms it the same way, but with no manual total:
row 7 runs alone and the snapshot copies the quote's total (``is_manual``
false). A changed price would be a repricing, which needs the customer's
documented agreement (BR-05), so it is not offered here.

Rules, in the order they are applied by :func:`confirm_order`:

1. **Only from the request's ``expected_status``**: ``quote_requested``, or
   ``awaiting_confirmation`` for an order with a quote. Any other status, a
   mismatch, or an ``awaiting_confirmation`` order without a quote is 409
   ``invalid_order_transition``. A repeated confirmation is therefore
   refused, never a second snapshot or SMS.
2. **Field checks** (422 ``validation_error``, every problem at once): the
   category is active, the source exists, the window starts no earlier than
   now (2 minutes' clock tolerance), the customer agreed no later than now
   and no earlier than the order was created. For a quoted order, the
   category is the quote's (the one the customer accepted, FR-023, FR-024)
   and, for a Tanker order, the source is of the kind the customer chose
   (``water_source``; a source with no kind set does not match). Schema
   checks (whole naira, total only for a quote request, end after start,
   ``other`` needs a note, disclosures confirmed) run first, in
   :mod:`app.modules.confirmation.schemas`.
3. **Row 7 checks under the order lock** (409 ``transition_requirements_unmet``
   with ``details.missing``): ``phone_verified``, ``source_eligible`` (the
   shared order-fit check, :func:`app.modules.sources.eligibility.source_order_reasons`,
   #407: safety, kind set, available, the order's litres and vehicle, read
   fresh with the source's rows locked, so options loaded earlier are never
   trusted) and ``delivery_window_set``. Nothing is written when one fails.
4. **One transaction** (question 1): row 26 ``quote_requested`` →
   ``awaiting_confirmation`` (reason ``manual_quote``; skipped for a quoted
   order, already there), then row 7 →
   ``confirmed`` with the dispatcher's note; the order gets its category,
   source and window, and payment ``pay_on_delivery`` /
   ``pending_collection`` (F4, docs/api/payments.md); the price snapshot is
   stored (FR-024); one audit row
   ``order_confirmed`` (NFR-004, ids and ``manual_quote``). The two events get increasing
   times so the history lists them in order.
5. **The confirmation SMS after the commit** (FR-050). Its outcome is stored
   on the order; a refused SMS never undoes the confirmation.

A source that stops being eligible later does not block assigning a driver
(decision 10): only the detail reports it (:func:`confirmation_view`).
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from http import HTTPStatus

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.modules.audit import service as audit_service
from app.modules.auth import service as auth_service
from app.modules.auth.models import User
from app.modules.messaging.sms import SmsDeliveryError, SmsProvider, mask_phone
from app.modules.orders import service as orders_service
from app.modules.orders.models import (
    ConfirmationSmsStatus,
    Order,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    TransitionReason,
)
from app.modules.orders.transitions import Requirement
from app.modules.pricing import quotes
from app.modules.pricing.models import AgreementMethod, OrderPriceSnapshot
from app.modules.sources.eligibility import (
    EligibilityReason,
    OrderFit,
    SourceReason,
    eligibility_reasons,
    reasons_for_order,
    source_order_reasons,
)
from app.modules.sources.models import (
    WaterCategory,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)
from app.shared.lagos_time import LAGOS_TZ, lagos_today
from app.shared.phone import format_phone_for_display

logger = logging.getLogger(__name__)

CLOCK_SKEW_TOLERANCE = timedelta(minutes=2)
# The row 7 event is written 1 microsecond after the row 26 event, so the
# history (newest first) lists "Confirmed" above "Awaiting confirmation".
_EVENT_GAP = timedelta(microseconds=1)
# Row 7, pilot alternative: typed window and pay on delivery (F3, F4).
_ROW_7_MET = frozenset(
    {
        Requirement.PHONE_VERIFIED,
        Requirement.SOURCE_ELIGIBLE,
        Requirement.DELIVERY_WINDOW_SET,
        Requirement.PAY_ON_DELIVERY,
    }
)


# --- Options (C1 sections 3 and 4) ------------------------------------------------


@dataclass(frozen=True)
class SourceOption:
    """One source for one category, with why it cannot be chosen (if it cannot)."""

    source: WaterSource
    activation: WaterSourceCategory | None
    reasons: list[SourceReason]


def order_fit(order: Order) -> OrderFit:
    """The order-fit inputs for an order (#407): whole-order litres, vehicle, preference."""
    return OrderFit(
        litres=order.quantity_litres,
        delivery_type=order.delivery_type.value if order.delivery_type is not None else None,
        preferred_kind=(
            WaterSourceKind(order.water_source.value) if order.water_source is not None else None
        ),
    )


@dataclass(frozen=True)
class CategoryOptions:
    """One active category with every source, eligible first."""

    category: WaterCategory
    sources: list[SourceOption]


async def confirmation_options(
    session: AsyncSession, *, reference: str, today: date | None = None
) -> list[CategoryOptions]:
    """Every active category with every source and why it cannot serve this order (C1).

    The reasons are the safety reasons and the #407 order-fit reasons for this
    order (docs/api/admin-water-sources.md, "The order-fit check"). They help
    the dispatcher choose; confirmation checks again (:func:`confirm_order`).

    Args:
        session: Database session; the caller enforces the admin role.
        reference: Public order reference.
        today: Today in Africa/Lagos (default: now).

    Returns:
        Categories by label; in each, sources that can be used first, then
        the rest, each group by name. Every list of sources is empty when no
        source is set up ("No water sources set up yet.").

    Raises:
        APIError: 404 ``order_not_found``.
    """
    staff = await orders_service.get_order_for_staff(session, reference=reference)
    fit = order_fit(staff.order)
    today = today or lagos_today()
    categories = list(
        await session.scalars(
            select(WaterCategory)
            .where(WaterCategory.is_active.is_(True))
            .order_by(WaterCategory.label)
        )
    )
    sources = list(await session.scalars(select(WaterSource).order_by(WaterSource.name)))
    activations = {
        (row.source_id, row.water_category_id): row
        for row in await session.scalars(select(WaterSourceCategory))
    }
    result: list[CategoryOptions] = []
    for category in categories:
        options = []
        for source in sources:
            activation = activations.get((source.id, category.id))
            options.append(
                SourceOption(
                    source, activation, reasons_for_order(source, activation, fit, today=today)
                )
            )
        # Stable sort keeps name order inside each group.
        options.sort(key=lambda option: bool(option.reasons))
        result.append(CategoryOptions(category, options))
    return result


# --- Confirm (rows 26 and 7) --------------------------------------------------------


@dataclass(frozen=True)
class ConfirmInput:
    """A validated ``ConfirmRequest`` (schema checks already passed).

    Attributes:
        expected_status: ``quote_requested`` or ``awaiting_confirmation``.
        total_minor_units: The manual total; None for a quoted order, whose
            quote's total is confirmed.
    """

    expected_status: OrderStatus
    water_category_id: uuid.UUID
    source_id: uuid.UUID
    window_start_at: datetime
    window_end_at: datetime
    total_minor_units: int | None
    agreement_method: AgreementMethod
    agreed_at: datetime
    note: str | None


def _field_error(loc: list[str | int], message: str) -> dict[str, object]:
    return {"loc": ["body", *loc], "msg": message, "type": "value_error"}


def _invalid_transition(source: OrderStatus) -> APIError:
    return APIError(
        HTTPStatus.CONFLICT,
        "invalid_order_transition",
        f"This order cannot move from {source} to {OrderStatus.CONFIRMED}.",
        details={"from": source.value, "to": OrderStatus.CONFIRMED.value},
    )


async def confirm_order(
    session: AsyncSession,
    *,
    reference: str,
    admin: User,
    data: ConfirmInput,
    sms: SmsProvider,
    now: datetime | None = None,
) -> None:
    """Confirm an order: a manual quote (rows 26 and 7), or its server quote (row 7). Commits.

    See the module docstring for the rules and their order.

    Args:
        session: Database session; the caller enforces the admin role and CSRF.
        reference: Public order reference.
        admin: The dispatcher confirming.
        data: The request, already checked by the schema.
        sms: Provider for the confirmation SMS.
        now: Current time, for tests.

    Raises:
        APIError: 404 ``order_not_found``; 409 ``invalid_order_transition``;
            422 ``validation_error``; 409 ``transition_requirements_unmet``.
    """
    now = now or datetime.now(UTC)
    staff = await orders_service.get_order_for_staff(session, reference=reference)
    order = await orders_service.lock_order(session, staff.order.id)
    quote = await quotes.get_quote(session, order.quote_id) if order.quote_id else None
    quoted = data.expected_status is OrderStatus.AWAITING_CONFIRMATION
    if order.status is not data.expected_status or quoted != (quote is not None):
        # Read before the rollback, which expires every loaded object.
        current = order.status
        await session.rollback()
        raise _invalid_transition(current)

    category = await session.get(WaterCategory, data.water_category_id)
    source = await session.get(WaterSource, data.source_id)
    errors = []
    if category is None or not category.is_active:
        errors.append(_field_error(["water_category_id"], "Choose an active water category"))
    if source is None:
        errors.append(_field_error(["source_id"], "Choose a water source from the list"))
    if quote is not None and data.water_category_id != quote.water_category_id:
        errors.append(
            _field_error(["water_category_id"], "Choose the water category of the order's quote")
        )
    if (
        quote is not None
        and source is not None
        and order.water_source is not None
        and source.kind != order.water_source
    ):
        errors.append(_field_error(["source_id"], "Choose a source of the kind the customer chose"))
    if data.window_start_at < now - CLOCK_SKEW_TOLERANCE:
        errors.append(
            _field_error(["delivery_window", "start_at"], "The window cannot start in the past")
        )
    if data.agreed_at > now + CLOCK_SKEW_TOLERANCE:
        errors.append(
            _field_error(["customer_agreement", "agreed_at"], "This time is in the future")
        )
    elif data.agreed_at < order.created_at:
        errors.append(
            _field_error(
                ["customer_agreement", "agreed_at"],
                "The customer cannot have agreed before the order was sent",
            )
        )
    if errors or category is None or source is None:
        await session.rollback()
        raise APIError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            "validation_error",
            "Request validation failed",
            details=errors,
        )

    missing = []
    if staff.customer.phone_verified_at is None:
        missing.append(Requirement.PHONE_VERIFIED)
    reasons = await source_order_reasons(
        session,
        source_id=source.id,
        water_category_id=category.id,
        fit=order_fit(order),
        today=now.astimezone(LAGOS_TZ).date(),
    )
    if reasons:
        missing.append(Requirement.SOURCE_ELIGIBLE)
    if not data.window_end_at > data.window_start_at:  # also checked by the schema
        missing.append(Requirement.DELIVERY_WINDOW_SET)
    if missing:
        await session.rollback()
        raise APIError(
            HTTPStatus.CONFLICT,
            "transition_requirements_unmet",
            "This step needs more information before it can be recorded.",
            details={"missing": sorted(requirement.value for requirement in missing)},
        )

    if quote is None:
        await orders_service.transition_order(
            session,
            order_id=order.id,
            target=OrderStatus.AWAITING_CONFIRMATION,
            actor=admin,
            reason_code=TransitionReason.MANUAL_QUOTE,
            occurred_at=now,
            commit=False,
        )
    # The schema requires a manual total exactly when there is no quote.
    total_minor_units = quote.total_minor_units if quote else data.total_minor_units
    if total_minor_units is None:
        raise ValueError("A quote request is confirmed with a manual total")
    order.water_category_id = category.id
    order.source_id = source.id
    order.delivery_window_start_at = data.window_start_at
    order.delivery_window_end_at = data.window_end_at
    # Every pilot order is pay on delivery (F4); the payment status stays
    # separate from the order status from here on (BR-12, docs/api/payments.md).
    order.payment_method = PaymentMethod.PAY_ON_DELIVERY
    order.payment_status = PaymentStatus.PENDING_COLLECTION
    confirmed_event_id = uuid.uuid4()
    await orders_service.transition_order(
        session,
        order_id=order.id,
        target=OrderStatus.CONFIRMED,
        actor=admin,
        satisfied=_ROW_7_MET,
        note=data.note,
        event_id=confirmed_event_id,
        occurred_at=now + _EVENT_GAP,
        commit=False,
    )
    session.add(
        OrderPriceSnapshot(
            order_id=order.id,
            event_id=confirmed_event_id,
            total_minor_units=total_minor_units,
            currency="NGN",
            is_manual=quote is None,
            water_category_id=category.id,
            water_category_label=category.label,
            source_id=source.id,
            delivery_window_start_at=data.window_start_at,
            delivery_window_end_at=data.window_end_at,
            entered_by=admin.id,
            entered_at=now,
            customer_agreement_method=data.agreement_method,
            customer_agreed_at=data.agreed_at,
        )
    )
    audit_service.record(
        session,
        actor_id=admin.id,
        action="order_confirmed",
        target_type="order",
        target_id=order.id,
        details={
            "source_id": str(source.id),
            "water_category_id": str(category.id),
            "manual_quote": quote is None,
        },
    )
    await session.commit()

    text = confirmation_message(
        reference=order.reference,
        window_start_at=data.window_start_at,
        window_end_at=data.window_end_at,
        total_minor_units=total_minor_units,
    )
    await _send_confirmation_sms(
        session, order=order, phone=staff.customer.phone, text=text, sms=sms, now=now
    )


def format_window(start_at: datetime, end_at: datetime) -> str:
    """A window in Lagos time: ``Tue 27 Oct 2026, 10:00 am to 12:00 pm``.

    A window that ends on another day names both days.
    """
    start, end = start_at.astimezone(LAGOS_TZ), end_at.astimezone(LAGOS_TZ)
    if start.date() == end.date():
        return f"{_lagos_date(start)}, {_lagos_time(start)} to {_lagos_time(end)}"
    return f"{_lagos_date(start)}, {_lagos_time(start)} to {_lagos_date(end)}, {_lagos_time(end)}"


def _lagos_date(moment: datetime) -> str:
    return f"{moment:%a} {moment.day} {moment:%b %Y}"


def _lagos_time(moment: datetime) -> str:
    hour = moment.hour % 12 or 12
    return f"{hour}:{moment:%M} {'am' if moment.hour < 12 else 'pm'}"


def format_sms_naira(total_minor_units: int) -> str:
    """Kobo as SMS money: ``N45,000.00``.

    "N" because "₦" is not in the GSM-7 SMS alphabet and would make the
    message a longer, costlier Unicode SMS (contract, "Confirmation SMS").
    """
    naira, kobo = divmod(total_minor_units, 100)
    return f"N{naira:,}.{kobo:02d}"


def confirmation_message(
    *, reference: str, window_start_at: datetime, window_end_at: datetime, total_minor_units: int
) -> str:
    """The confirmation SMS (FR-050, wording agreed in decision 8).

    No water-quality or delivery promise; it carries the support number.

    Args:
        reference: Public order reference.
        window_start_at: Confirmed window start (UTC).
        window_end_at: Its end.
        total_minor_units: Manual quote total in kobo.

    Returns:
        The text, e.g. "MmiriOma: order MO-7KQ2M9XH4T is confirmed for Tue 27
        Oct 2026, 10:00 am to 12:00 pm. Total N45,000.00, pay cash after
        unloading. Help: +234 813 377 4902".
    """
    window = format_window(window_start_at, window_end_at)
    support = format_phone_for_display(get_settings().support_phone)
    return (
        f"MmiriOma: order {reference} is confirmed for {window}. "
        f"Total {format_sms_naira(total_minor_units)}, pay cash after unloading. "
        f"Help: {support}"
    )


async def _send_confirmation_sms(
    session: AsyncSession,
    *,
    order: Order,
    phone: str,
    text: str,
    sms: SmsProvider,
    now: datetime,
) -> None:
    """Send the confirmation SMS and store whether the provider accepted it.

    Runs after the confirmation is committed: whatever happens here, the order
    stays confirmed (FR-050). Nothing claims a refused message was sent.
    """
    try:
        await sms.send(phone=phone, text=text)
        status = ConfirmationSmsStatus.ACCEPTED
    except SmsDeliveryError as error:
        logger.warning(
            "Confirmation SMS for %s to %s not accepted: %s",
            order.reference,
            mask_phone(phone),
            error,
        )
        status = ConfirmationSmsStatus.NOT_ACCEPTED
    locked = await orders_service.lock_order(session, order.id)
    locked.confirmation_sms_status = status
    locked.confirmation_sms_attempted_at = now
    await session.commit()


# --- Detail and history (C2, H1) -----------------------------------------------------


@dataclass(frozen=True)
class ConfirmedSource:
    """The order's source with its current eligibility for the order's category."""

    source: WaterSource
    report_reference: str | None
    reasons: list[EligibilityReason]


@dataclass(frozen=True)
class ConfirmationView:
    """What the admin detail shows about confirmation (C2).

    Every part is None on an order that was never confirmed this way.
    """

    water_category: WaterCategory | None
    source: ConfirmedSource | None
    snapshot: OrderPriceSnapshot | None
    entered_by: User | None


EMPTY_VIEW = ConfirmationView(water_category=None, source=None, snapshot=None, entered_by=None)


async def confirmation_view(
    session: AsyncSession, order: Order, *, today: date | None = None
) -> ConfirmationView:
    """Load the confirmation details for the admin order detail.

    The source's ``reasons`` are its **current** eligibility for the order's
    category (C2 warning; decision 10: it blocks nothing). An order with a
    source but no category (set by script before #113) has none to check.

    Args:
        session: Database session.
        order: The order.
        today: Today in Africa/Lagos (default: now).

    Returns:
        The view; :data:`EMPTY_VIEW` parts are None when not set.
    """
    category = (
        await session.get(WaterCategory, order.water_category_id)
        if order.water_category_id
        else None
    )
    confirmed_source = None
    if order.source_id is not None:
        source = await session.get(WaterSource, order.source_id)
        activation = None
        reasons: list[EligibilityReason] = []
        if source is not None and category is not None:
            activation = await session.scalar(
                select(WaterSourceCategory).where(
                    WaterSourceCategory.source_id == source.id,
                    WaterSourceCategory.water_category_id == category.id,
                )
            )
            reasons = eligibility_reasons(activation, today=today or lagos_today())
        if source is not None:
            confirmed_source = ConfirmedSource(
                source=source,
                report_reference=None if activation is None else activation.report_reference,
                reasons=reasons,
            )
    snapshot = await session.scalar(
        select(OrderPriceSnapshot).where(OrderPriceSnapshot.order_id == order.id)
    )
    entered_by = None
    if snapshot is not None:
        entered_by = (await auth_service.get_users_by_ids(session, {snapshot.entered_by})).get(
            snapshot.entered_by
        )
    return ConfirmationView(
        water_category=category,
        source=confirmed_source,
        snapshot=snapshot,
        entered_by=entered_by,
    )


@dataclass(frozen=True)
class ConfirmationLine:
    """The confirmation details shown on the history's row 7 entry."""

    water_category_label: str
    source_name: str
    window_start_at: datetime
    window_end_at: datetime
    total_minor_units: int
    manual: bool


async def confirmation_lines(
    session: AsyncSession, event_ids: set[uuid.UUID]
) -> dict[uuid.UUID, ConfirmationLine]:
    """Map each confirming event among ``event_ids`` to its confirmation line.

    Args:
        session: Database session.
        event_ids: History event ids; most are not confirmations.

    Returns:
        Only the events that confirmed an order with a price snapshot.
    """
    if not event_ids:
        return {}
    rows = (
        await session.execute(
            select(OrderPriceSnapshot, WaterSource.name)
            .join(WaterSource, WaterSource.id == OrderPriceSnapshot.source_id)
            .where(OrderPriceSnapshot.event_id.in_(event_ids))
        )
    ).all()
    return {
        snapshot.event_id: ConfirmationLine(
            water_category_label=snapshot.water_category_label,
            source_name=source_name,
            window_start_at=snapshot.delivery_window_start_at,
            window_end_at=snapshot.delivery_window_end_at,
            total_minor_units=snapshot.total_minor_units,
            manual=snapshot.is_manual,
        )
        for snapshot, source_name in rows
    }
