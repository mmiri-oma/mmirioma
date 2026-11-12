"""Source eligibility: may this source serve this water category today? (FR-012)

One check, shared by order confirmation (C1, #113) and the hold review's
source review (R2, :mod:`app.modules.deliveries.holds`). Contract:
docs/api/deliveries.md, "Order confirmation endpoints", "Source eligibility
(shared with R2)" (agreed 2026-10-22, PR #111).

The answer is a list of reasons; an empty list means eligible. A source can
have several reasons at once, for example a suspended activation whose
laboratory approval has also expired. Reasons are always listed in the
contract's order (:data:`REASON_ORDER`), because R2 shows the message of the
first one.

"Today" is the calendar date in Africa/Lagos: an approval valid until
``2026-10-31`` still counts on 31 October in Lagos and has expired from
1 November (T-04).

**The order-fit check (#407).** :func:`eligible_sources_for` and
:func:`source_order_reasons` add six :class:`OrderFitReason` values after the
four safety reasons, for one order: the source has a kind, is available,
matches a Tanker customer's preferred kind, accepts the order's litres, and
can be loaded by the order's vehicle (docs/api/admin-water-sources.md,
"The order-fit check", agreed 2026-11-12, PR #417). Quotes, quote acceptance,
the order confirmation options (C1) and the confirmation itself use it. The
hold review's source review (R2) and the order detail keep the four safety
reasons only, through :func:`eligibility_reasons` and :func:`source_reasons`.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.sources.locations import SourceLocation, source_locations
from app.modules.sources.models import (
    ActivationStatus,
    WaterSource,
    WaterSourceCategory,
    WaterSourceKind,
)


class EligibilityReason(StrEnum):
    """Why a source cannot serve a category (contract, "Source eligibility")."""

    NOT_ACTIVATED = "not_activated"
    SUSPENDED = "suspended"
    REVOKED = "revoked"
    APPROVAL_EXPIRED = "approval_expired"


#: The contract's order. R2's message comes from the first reason.
REASON_ORDER = (
    EligibilityReason.NOT_ACTIVATED,
    EligibilityReason.SUSPENDED,
    EligibilityReason.REVOKED,
    EligibilityReason.APPROVAL_EXPIRED,
)


def eligibility_reasons(
    activation: WaterSourceCategory | None, *, today: date
) -> list[EligibilityReason]:
    """Return why a source cannot serve a category, or ``[]`` if it can.

    Args:
        activation: The source's activation for the category, or None when
            it has none.
        today: Today's date in Africa/Lagos.

    Returns:
        The reasons in :data:`REASON_ORDER`. ``[]`` means eligible.

    Examples:
        No activation gives ``[not_activated]``. A suspended activation
        whose approval ended yesterday gives ``[suspended, approval_expired]``.
    """
    if activation is None:
        return [EligibilityReason.NOT_ACTIVATED]
    reasons: list[EligibilityReason] = []
    if activation.status is ActivationStatus.SUSPENDED:
        reasons.append(EligibilityReason.SUSPENDED)
    elif activation.status is ActivationStatus.REVOKED:
        reasons.append(EligibilityReason.REVOKED)
    if activation.approved_until < today:
        reasons.append(EligibilityReason.APPROVAL_EXPIRED)
    return reasons


async def source_reasons(
    session: AsyncSession,
    *,
    source_id: uuid.UUID,
    water_category_id: uuid.UUID,
    today: date,
) -> list[EligibilityReason]:
    """Load a source's activation for a category and return its reasons.

    Args:
        session: Database session.
        source_id: The water source.
        water_category_id: The water category.
        today: Today's date in Africa/Lagos.

    Returns:
        As :func:`eligibility_reasons`.
    """
    activation = await session.scalar(
        select(WaterSourceCategory).where(
            WaterSourceCategory.source_id == source_id,
            WaterSourceCategory.water_category_id == water_category_id,
        )
    )
    return eligibility_reasons(activation, today=today)


# --- The order-fit check (#407) ---------------------------------------------------


class OrderFitReason(StrEnum):
    """Why a source cannot serve one order, after the safety reasons (#407).

    Listed in the contract's order, after :data:`REASON_ORDER`.
    """

    #: The source has no kind (decision 407-2). Source-wide.
    KIND_NOT_SET = "kind_not_set"
    #: An admin marked the source unavailable. Source-wide; not a safety status.
    UNAVAILABLE = "unavailable"
    #: A Tanker customer chose a source kind and this source is the other one.
    KIND_MISMATCH = "kind_mismatch"
    #: The order's litres are below the source's minimum (D14).
    BELOW_MINIMUM_LITRES = "below_minimum_litres"
    #: The order's litres are above the source's maximum (D14).
    ABOVE_MAXIMUM_LITRES = "above_maximum_litres"
    #: The order's vehicle cannot load at this source (D14).
    VEHICLE_NOT_SUITABLE = "vehicle_not_suitable"


#: A reason in the C1 confirmation options: a safety reason or an order-fit one.
type SourceReason = EligibilityReason | OrderFitReason


@dataclass(frozen=True)
class OrderFit:
    """What the order-fit check needs to know about one order.

    Attributes:
        litres: The complete order's quantity in whole litres (decision 407-3).
        delivery_type: ``keke`` or ``tanker``; None for an order placed before
            delivery types existed, whose vehicle is not checked.
        preferred_kind: A Tanker customer's chosen source kind, or None (every
            Keke order, and a Tanker order without a preference).
    """

    litres: int
    delivery_type: str | None
    preferred_kind: WaterSourceKind | None


def source_wide_reasons(source: WaterSource) -> list[OrderFitReason]:
    """Return the reasons that exclude a source from every order today.

    Args:
        source: The source.

    Returns:
        ``kind_not_set`` and ``unavailable``, in that order, when they apply.
        The admin screen shows them as ``source_reasons``.
    """
    reasons: list[OrderFitReason] = []
    if source.kind is None:
        reasons.append(OrderFitReason.KIND_NOT_SET)
    if not source.is_available:
        reasons.append(OrderFitReason.UNAVAILABLE)
    return reasons


def order_fit_reasons(source: WaterSource, fit: OrderFit) -> list[OrderFitReason]:
    """Return why a source does not fit one order, or ``[]`` if it does.

    The litre limits are inclusive: an order of exactly the minimum or the
    maximum fits. A source with no kind gets ``kind_not_set`` and never also
    ``kind_mismatch``.

    Args:
        source: The source.
        fit: The order.

    Returns:
        The :class:`OrderFitReason` values that apply, in the contract's order.
    """
    reasons = source_wide_reasons(source)
    if (
        fit.preferred_kind is not None
        and source.kind is not None
        and source.kind != fit.preferred_kind
    ):
        reasons.append(OrderFitReason.KIND_MISMATCH)
    if source.min_litres_per_order is not None and fit.litres < source.min_litres_per_order:
        reasons.append(OrderFitReason.BELOW_MINIMUM_LITRES)
    if source.max_litres_per_order is not None and fit.litres > source.max_litres_per_order:
        reasons.append(OrderFitReason.ABOVE_MAXIMUM_LITRES)
    if fit.delivery_type is not None and fit.delivery_type not in source.vehicle_kinds:
        reasons.append(OrderFitReason.VEHICLE_NOT_SUITABLE)
    return reasons


def reasons_for_order(
    source: WaterSource,
    activation: WaterSourceCategory | None,
    fit: OrderFit,
    *,
    today: date,
) -> list[SourceReason]:
    """Return every reason a source cannot serve one order in one category.

    Args:
        source: The source.
        activation: Its activation for the category, or None.
        fit: The order.
        today: Today's date in Africa/Lagos.

    Returns:
        The safety reasons first, then the order-fit reasons; ``[]`` means
        the source can serve the order.
    """
    return [*eligibility_reasons(activation, today=today), *order_fit_reasons(source, fit)]


@dataclass(frozen=True)
class SourceCandidate:
    """One source checked against one order, as the server sees it.

    Attributes:
        source_id: The source.
        cost_per_litre_minor_units: Its activation's cost in kobo, or None when
            it has no activation for the category. Never sent to a client.
        location: Its pickup point, or None.
        reasons: Why it cannot serve the order; ``[]`` means it can.
    """

    source_id: uuid.UUID
    cost_per_litre_minor_units: int | None
    location: SourceLocation | None
    reasons: list[SourceReason]

    @property
    def eligible(self) -> bool:
        """Whether the source can serve the order."""
        return not self.reasons


async def eligible_sources_for(
    session: AsyncSession,
    *,
    water_category_id: uuid.UUID,
    fit: OrderFit,
    today: date,
) -> list[SourceCandidate]:
    """Check every source against one order, and say why each excluded one is.

    The shared check for quotes, quote acceptance and the C1 options, and for
    #408 (road pricing) and #411 (dispatch). The costs and pickup points are
    for the server's own use (FR-011).

    Args:
        session: Database session.
        water_category_id: The order's water category.
        fit: The order.
        today: Today's date in Africa/Lagos.

    Returns:
        One candidate per source, by name. Filter on
        :attr:`SourceCandidate.eligible` for the sources that can serve it.
    """
    sources = list(await session.scalars(select(WaterSource).order_by(WaterSource.name)))
    activations = {
        activation.source_id: activation
        for activation in await session.scalars(
            select(WaterSourceCategory).where(
                WaterSourceCategory.water_category_id == water_category_id
            )
        )
    }
    locations = await source_locations(session, [source.id for source in sources])
    candidates = []
    for source in sources:
        activation = activations.get(source.id)
        candidates.append(
            SourceCandidate(
                source_id=source.id,
                cost_per_litre_minor_units=(
                    activation.cost_per_litre_minor_units if activation is not None else None
                ),
                location=locations.get(source.id),
                reasons=reasons_for_order(source, activation, fit, today=today),
            )
        )
    return candidates


async def source_order_reasons(
    session: AsyncSession,
    *,
    source_id: uuid.UUID,
    water_category_id: uuid.UUID,
    fit: OrderFit,
    today: date,
) -> list[SourceReason]:
    """Check one chosen source against one order, holding its rows until commit.

    Confirmation calls this under the order lock. The source and its
    activation are read again with ``FOR SHARE`` and fresh values (not ones
    loaded earlier in the session), so an admin edit saving at the same moment
    either commits first and is seen here, or waits until the confirmation
    commits. Options loaded earlier are never trusted.

    Args:
        session: Database session, inside the confirming transaction.
        source_id: The chosen source.
        water_category_id: The order's water category.
        fit: The order.
        today: Today's date in Africa/Lagos.

    Returns:
        As :func:`reasons_for_order`.

    Raises:
        LookupError: No source has this id.
    """
    source = await session.scalar(
        select(WaterSource)
        .where(WaterSource.id == source_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if source is None:
        raise LookupError("no water source has this id")
    activation = await session.scalar(
        select(WaterSourceCategory)
        .where(
            WaterSourceCategory.source_id == source_id,
            WaterSourceCategory.water_category_id == water_category_id,
        )
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return reasons_for_order(source, activation, fit, today=today)
