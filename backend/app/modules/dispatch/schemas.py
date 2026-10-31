"""Request and response models for the admin dispatch endpoints.

Shapes follow docs/api/deliveries.md, "Admin dispatch endpoints" (agreed in
G3, PR #59). Responses name people by account id and name only; the
customer's details stay in ``AdminOrderRead`` as before.
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from app.modules.auth.models import User, UserRole
from app.modules.confirmation.schemas import ConfirmationLineRead, OrderConfirmationFields
from app.modules.confirmation.service import ConfirmationLine
from app.modules.dispatch.models import AssignmentStatus, DeclineReason, VehicleProfile
from app.modules.dispatch.service import (
    AssignmentView,
    DispatchOrder,
    DriverChoice,
    HistoryEntry,
    Ineligibility,
)
from app.modules.orders.models import EVENT_NOTE_MAX_LENGTH, OrderStatus, TransitionReason
from app.modules.orders.schemas import AdminOrderRead, OrderHoldRead
from app.modules.orders.service import ReadLookups
from app.modules.payments.schemas import OrderPaymentRead

WithdrawNote = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=EVENT_NOTE_MAX_LENGTH)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Requests ----------------------------------------------------------------


class AssignRequest(_Request):
    """Body of ``POST /admin/orders/{reference}/assign``.

    Attributes:
        driver_id: The driver's account id.
    """

    driver_id: uuid.UUID


class WithdrawRequest(_Request):
    """Body of ``POST /admin/orders/{reference}/withdraw``.

    Attributes:
        expected_status: The assignment status the dispatcher saw:
            ``offered`` (Withdraw offer) or ``accepted`` (Withdraw job).
            Required, so a withdraw cannot take back a job accepted a
            moment earlier (admin dispatch decision 1).
        note: Optional, trimmed, up to 500 characters; blank is stored as
            null. Saved as the event's note.
    """

    expected_status: Literal["offered", "accepted"]
    note: WithdrawNote | None = None

    @field_validator("note")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return value or None


# --- Responses ---------------------------------------------------------------


class PersonRead(BaseModel):
    """An account named in a dispatch response."""

    id: uuid.UUID
    name: str

    @classmethod
    def from_user(cls, user: User) -> PersonRead:
        return cls(id=user.id, name=user.name)


class ContactAttemptRead(BaseModel):
    """One attempt to reach the customer after arrival: the server's time (FR-038).

    The item of ``AdminOrderDetail.contact_attempts`` and of
    ``HoldReview.proof.contact_attempts``. Times only: no number, location or note.
    """

    attempted_at: datetime


class VehicleRead(BaseModel):
    """A driver's vehicle: type and verified safe payload per trip (FR-013)."""

    type: str
    safe_payload_litres: int

    @classmethod
    def from_vehicle(cls, vehicle: VehicleProfile | None) -> VehicleRead | None:
        if vehicle is None:
            return None
        return cls(type=vehicle.vehicle_type, safe_payload_litres=vehicle.safe_payload_litres)


class AdminAssignment(BaseModel):
    """One offer of the order to one driver (``AdminAssignment`` in the contract).

    Attributes:
        offered_at: When the offer was made. The client counts up from it;
            there is no expiry (FR-032, technical lead 2026-10-19).
        responded_at: The accepted time (``accepted``) or declined time
            (``declined``); null before the driver answers.
        ended_at: When it stopped being live.
        decline_reason: Only for ``declined``.
        decline_note: The driver's words with a decline.
    """

    id: uuid.UUID
    status: AssignmentStatus
    driver: PersonRead
    vehicle: VehicleRead | None
    offered_by: PersonRead
    offered_at: datetime
    responded_at: datetime | None
    ended_at: datetime | None
    decline_reason: DeclineReason | None
    decline_note: str | None

    @classmethod
    def from_view(cls, view: AssignmentView) -> AdminAssignment:
        assignment = view.assignment
        return cls(
            id=assignment.id,
            status=assignment.status,
            driver=PersonRead.from_user(view.driver),
            vehicle=VehicleRead.from_vehicle(view.vehicle),
            offered_by=PersonRead.from_user(view.offered_by),
            offered_at=assignment.created_at,
            responded_at=assignment.responded_at,
            ended_at=assignment.ended_at,
            decline_reason=assignment.decline_reason,
            decline_note=assignment.decline_note,
        )


class AdminOrderDetail(AdminOrderRead, OrderConfirmationFields):
    """``AdminOrderRead`` plus the most recent assignment and the confirmation (detail only).

    The confirmation fields (``water_category``, ``source``,
    ``delivery_window``, ``price``, ``confirmation_sms``) come from the order
    confirmation contract (PR #111) and are null on unconfirmed orders.

    Attributes:
        assignment: Live or ended; null if the order was never offered.
        payment: The payment card (docs/api/payments.md); null before the
            order is confirmed.
        contact_attempts: Every contact attempt recorded on the order, oldest
            first; empty when no driver has reached the customer (FR-038,
            docs/api/deliveries.md, "Amendment (#280)").
    """

    assignment: AdminAssignment | None
    payment: OrderPaymentRead | None
    contact_attempts: list[ContactAttemptRead]

    @classmethod
    def from_dispatch(
        cls,
        dispatch: DispatchOrder,
        hold: OrderHoldRead | None,
        confirmation: OrderConfirmationFields,
        payment: OrderPaymentRead | None,
        *,
        contact_attempts: Sequence[datetime],
        lookups: ReadLookups,
    ) -> AdminOrderDetail:
        """Build the detail from the dispatch view, the open hold, the confirmation and payment.

        ``confirmation``, ``payment`` and ``contact_attempts`` are required,
        not defaulted: the admin client replaces its cached detail with every
        response, so a response without them would hide the confirmed summary
        (C2), the payment card (K6) or the contact attempts of a failed
        delivery (#280). ``lookups`` covers the order's zone and quote
        (``orders.service.read_lookups``).
        """
        staff = dispatch.staff_order
        return cls(
            **AdminOrderRead.from_order(
                staff.order, staff.customer, hold, lookups=lookups
            ).model_dump(),
            **confirmation.model_dump(),
            assignment=None
            if dispatch.assignment is None
            else AdminAssignment.from_view(dispatch.assignment),
            payment=payment,
            contact_attempts=[ContactAttemptRead(attempted_at=at) for at in contact_attempts],
        )


class DispatchDriver(BaseModel):
    """One row of the Assign driver list (D1).

    Attributes:
        vehicle: Null when the driver has no profile (``no_driver_profile``).
        reasons: Every eligibility problem for this order (FR-031); empty
            means the driver can be offered it.
    """

    id: uuid.UUID
    name: str
    vehicle: VehicleRead | None
    reasons: list[Ineligibility]

    @classmethod
    def from_choice(cls, choice: DriverChoice) -> DispatchDriver:
        return cls(
            id=choice.driver.id,
            name=choice.driver.name,
            vehicle=VehicleRead.from_vehicle(choice.vehicle),
            reasons=choice.reasons,
        )


class DispatchDriverList(BaseModel):
    """Body of ``GET /admin/orders/{reference}/drivers``."""

    items: list[DispatchDriver]


class EventActor(BaseModel):
    """Who made a change: account id, role and name when read."""

    id: uuid.UUID
    role: UserRole
    name: str


class EventAssignment(BaseModel):
    """The assignment an event of rows 8-11 is about.

    Attributes:
        decline_reason: Set only on a decline event.
    """

    id: uuid.UUID
    driver: PersonRead
    decline_reason: DeclineReason | None


class AdminOrderEvent(BaseModel):
    """One history entry (H1): the event object plus names (decision 2).

    Attributes:
        confirmation: Only on the entry that confirmed the order with a
            price (order confirmation contract); null on every other entry.
    """

    id: uuid.UUID
    from_status: OrderStatus | None
    to_status: OrderStatus
    actor: EventActor | None
    reason_code: TransitionReason | None
    note: str | None
    created_at: datetime
    assignment: EventAssignment | None
    confirmation: ConfirmationLineRead | None

    @classmethod
    def from_entry(
        cls, entry: HistoryEntry, confirmations: Mapping[uuid.UUID, ConfirmationLine]
    ) -> AdminOrderEvent:
        """Build an entry; ``confirmations`` maps confirming event ids to their line."""
        event = entry.event
        return cls(
            id=event.id,
            from_status=event.from_status,
            to_status=event.to_status,
            actor=None
            if entry.actor is None
            else EventActor(id=entry.actor.id, role=entry.actor.role, name=entry.actor.name),
            reason_code=event.reason_code,
            note=event.note,
            created_at=event.created_at,
            assignment=None
            if entry.assignment is None or entry.assignment_driver is None
            else EventAssignment(
                id=entry.assignment.id,
                driver=PersonRead.from_user(entry.assignment_driver),
                decline_reason=entry.decline_reason,
            ),
            confirmation=ConfirmationLineRead.from_line(confirmations.get(event.id)),
        )


class AdminOrderHistory(BaseModel):
    """Body of ``GET /admin/orders/{reference}/history``: newest first."""

    items: list[AdminOrderEvent]
