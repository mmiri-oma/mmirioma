"""Privacy requests and the monthly retention review (NFR-005, #129).

Implements the database steps of ``docs/process/privacy-retention.md``,
which carries out what ``PRIVACY_NOTICE.md`` promises (sections 8 to 10).
There are no screens: the technical lead runs ``app.modules.privacy.cli``.
Each module owns its tables, so this service only orchestrates the
``retention`` functions of ``auth``, ``customers``, ``dispatch``,
``orders``, ``deliveries`` and ``payments``. Customers are anonymized with
:func:`anonymize_customer`, riders and drivers with
:func:`anonymize_partner` (#119).

Every operation names the admin account running it and writes an audit row
(NFR-004) with ids and counts only, never personal data. Anonymizing and
the review run as a **dry run** unless ``apply`` is true: the same steps run
and are then rolled back, so the report shows exactly what applying would
change.

Cash (#123) is checked by ``payments.retention``: anonymizing is refused
while a customer's cash is unsettled in the app, and part payments and
overpayments settled outside the app (F9, F7) are reported as warnings for
the privacy contact to check.
"""

import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.auth import retention as accounts
from app.modules.auth import service as auth_service
from app.modules.auth.models import User, UserRole
from app.modules.customers import requests as customer_requests
from app.modules.customers import retention as addresses
from app.modules.customers.models import DeletionRequestStatus
from app.modules.deliveries import retention as deliveries
from app.modules.dispatch import retention as jobs
from app.modules.notifications import service as notifications
from app.modules.orders import retention as orders
from app.modules.payments import retention as payments

# Retention periods from PRIVACY_NOTICE.md section 8.
UNVERIFIED_ACCOUNT_PERIOD = timedelta(days=30)
GPS_PERIOD = timedelta(days=90)
ORDER_PERIOD_YEARS = 3
COMPLAINT_PERIOD_YEARS = 3
#: Deletion requests, after they are completed or refused (#118).
DELETION_REQUEST_PERIOD_YEARS = 3


class CustomerNotReady(Exception):
    """The customer has orders or matters that must close before anonymizing.

    Attributes:
        blockers: One readable line per blocking order.
    """

    def __init__(self, blockers: list[str]) -> None:
        super().__init__("the customer has open orders or matters")
        self.blockers = blockers


@dataclass(frozen=True)
class AnonymizeResult:
    """What anonymizing a customer changed (or would change, in a dry run).

    Attributes:
        customer_id: The account's id, for the request register.
        orders_anonymized: Orders whose contact and address were removed.
        gps_points_cleared: GPS points removed from those orders.
        addresses_removed: Saved addresses deleted (profile data, notice §8).
        support_messages_removed: Support request messages replaced; the
            deletion request's reason is blanked too.
        resolution_notes_removed: Staff resolution notes on those support
            requests replaced (#117).
        notifications_deleted: In-app notifications deleted (contract
            decision 8).
        notes_to_review: Free-text notes kept on those orders and their cash
            records, for the privacy contact to check for personal details.
        cash_warnings: Part payments and overpayments settled outside the
            app (F9, F7), one line per order, for the privacy contact to
            check before applying.
        applied: False for a dry run (nothing was saved).
    """

    customer_id: uuid.UUID
    orders_anonymized: int
    gps_points_cleared: int
    addresses_removed: int
    support_messages_removed: int
    resolution_notes_removed: int
    notifications_deleted: int
    notes_to_review: int
    cash_warnings: list[str]
    applied: bool


class PartnerNotReady(Exception):
    """The rider or driver has jobs, cash or matters that must close first.

    Attributes:
        blockers: One readable line per blocking order.
    """

    def __init__(self, blockers: list[str]) -> None:
        super().__init__("the partner has live jobs, unsettled cash or open matters")
        self.blockers = blockers


@dataclass(frozen=True)
class PartnerAnonymizeResult:
    """What anonymizing a rider or driver changed (or would change, in a dry run).

    Attributes:
        partner_id: The account's id, for the request register.
        zones_removed: Service zones removed from their profile.
        decline_notes_removed: Their own words on declines, replaced.
        gps_points_cleared: GPS points they recorded, cleared.
        notifications_deleted: Their in-app notifications deleted.
        reasons_cleared: Audit rows about them whose staff reason was
            replaced by the ``reason_removed`` marker.
        notes_to_review: Incident and pickup safety notes they wrote, kept
            as safety records, for the privacy contact to check by hand.
        applied: False for a dry run (nothing was saved).
    """

    partner_id: uuid.UUID
    zones_removed: int
    decline_notes_removed: int
    gps_points_cleared: int
    notifications_deleted: int
    reasons_cleared: int
    notes_to_review: int
    applied: bool


@dataclass(frozen=True)
class ReviewResult:
    """What the monthly review changed (or would change, in a dry run).

    Attributes:
        phone_codes_cleared: Expired phone verification codes blanked.
        delivery_codes_cleared: Expired delivery codes blanked.
        sessions_deleted: Ended sign-in sessions deleted.
        unverified_accounts_deleted: Never-verified accounts deleted.
        unverified_accounts_anonymized: Never-verified accounts anonymized
            instead, because audit rows name them as the actor (NFR-004).
        gps_points_cleared: GPS points older than 90 days removed.
        orders_anonymized: Orders finished over 3 years ago anonymized.
        support_requests_deleted: Support requests resolved over 3 years
            ago deleted (complaints, notice §8; #82).
        deletion_requests_deleted: Deletion requests completed or refused
            over 3 years ago deleted (notice §8; #118).
        applied: False for a dry run (nothing was saved).
    """

    phone_codes_cleared: int
    delivery_codes_cleared: int
    sessions_deleted: int
    unverified_accounts_deleted: int
    unverified_accounts_anonymized: int
    gps_points_cleared: int
    orders_anonymized: int
    support_requests_deleted: int
    deletion_requests_deleted: int
    applied: bool


async def get_acting_admin(session: AsyncSession, *, phone: str) -> User:
    """Return the active admin account running a privacy command.

    Args:
        session: Database session.
        phone: Normalized phone of the admin.

    Returns:
        The admin.

    Raises:
        LookupError: No active admin account has this phone.
    """
    user = await auth_service.get_user_by_phone(session, phone)
    if user is None or user.role is not UserRole.ADMIN or not user.is_active:
        raise LookupError("no active admin account has this phone")
    return user


def years_before(moment: datetime, years: int) -> datetime:
    """The same date and time ``years`` years earlier (29 Feb becomes 28 Feb)."""
    try:
        return moment.replace(year=moment.year - years)
    except ValueError:
        return moment.replace(year=moment.year - years, day=28)


async def _finish(session: AsyncSession, apply: bool) -> None:
    if apply:
        await session.commit()
    else:
        await session.rollback()


async def anonymize_customer(
    session: AsyncSession,
    *,
    actor: User,
    customer_phone: str,
    now: datetime,
    apply: bool,
) -> AnonymizeResult:
    """Anonymize a customer after a verified deletion request.

    Procedure "Deletion" steps 1-3. Refused while any of the customer's
    orders is not finished (only ``delivered`` and ``cancelled`` are), has
    an open hold or review, or has cash not settled in the app
    (``payments.retention.cash_blockers``), so nothing needed for a live
    order or for the cash records is removed.
    Otherwise, in one transaction: the account is anonymized and deactivated
    (``auth.retention``), each order's contact and address details are
    removed (``orders.retention``), their GPS points are cleared
    (``deliveries.retention``), their saved addresses are deleted, their
    support request messages and deletion reason removed
    (``customers.retention``), their in-app notifications deleted, and an
    audit row is written. The deletion request itself is marked
    ``completed`` separately (:func:`set_deletion_request_status`). Orders, cash
    and accounting fields, and staff notes are kept.

    Args:
        session: Database session.
        actor: The admin running it (:func:`get_acting_admin`).
        customer_phone: The customer's normalized phone.
        now: Time of the change.
        apply: Save the changes; otherwise roll them back (dry run).

    Returns:
        What changed.

    Raises:
        LookupError: No customer account has this phone.
        CustomerNotReady: An order is unfinished, has an open matter or has
            unsettled cash.
    """
    customer = await accounts.get_customer(session, phone=customer_phone)
    customer_id = customer.id
    order_ids = await orders.customer_order_ids(session, customer_id=customer_id)

    blockers = [
        f"{reference}: {status.value}"
        for reference, status in await orders.unfinished_orders(session, customer_id=customer_id)
    ]
    open_matters = await deliveries.open_matter_order_ids(session, order_ids=order_ids)
    blockers += [
        f"{reference}: open hold or review"
        for reference in await orders.order_references(session, order_ids=open_matters)
    ]
    blockers += await payments.cash_blockers(session, order_ids=order_ids)
    if blockers:
        raise CustomerNotReady(blockers)

    warnings = await payments.cash_warnings(session, order_ids=order_ids)
    notes = await orders.count_event_notes(session, order_ids=order_ids)
    notes += await deliveries.count_notes(session, order_ids=order_ids)
    notes += await payments.count_notes(session, order_ids=order_ids)
    marker = await accounts.new_phone_marker(session)
    await accounts.anonymize_account(session, customer, phone_marker=marker)
    anonymized = await orders.anonymize_orders(session, order_ids=order_ids, now=now)
    gps = await deliveries.clear_order_gps(session, order_ids=order_ids, now=now)
    removed = await addresses.delete_addresses(session, customer_ids=[customer_id])
    cleared = await addresses.clear_requests(session, customer_ids=[customer_id])
    deleted_notes = await notifications.delete_for_users(session, user_ids=[customer_id])
    audit.record(
        session,
        actor_id=actor.id,
        action="customer_anonymized",
        target_type="user",
        target_id=customer_id,
        details={
            "orders_anonymized": anonymized,
            "gps_points_cleared": gps,
            "addresses_removed": removed,
            "support_messages_removed": cleared.messages,
            "resolution_notes_removed": cleared.resolution_notes,
            "notifications_deleted": deleted_notes,
        },
    )
    await _finish(session, apply)
    return AnonymizeResult(
        customer_id=customer_id,
        orders_anonymized=anonymized,
        gps_points_cleared=gps,
        addresses_removed=removed,
        support_messages_removed=cleared.messages,
        resolution_notes_removed=cleared.resolution_notes,
        notifications_deleted=deleted_notes,
        notes_to_review=notes,
        cash_warnings=warnings,
        applied=apply,
    )


async def anonymize_partner(
    session: AsyncSession,
    *,
    actor: User,
    partner_phone: str,
    now: datetime,
    apply: bool,
) -> PartnerAnonymizeResult:
    """Anonymize a rider or driver after a verified deletion request (#119).

    Procedure "Deletion", riders and drivers. Rules confirmed by the privacy
    contact on #119 (2026-10-27). Refused while the partner has a live job
    (offered or accepted), cash not reconciled (FR-041, BR-12), or an open
    hold or review, or a dispute, on a job they accepted, so nothing needed
    for a live job or for the cash records is removed.

    Otherwise, in one transaction: the account is anonymized ("Former rider
    or driver") and deactivated (``auth.retention``); the profile's plate,
    capacity, availability, switches and transfer methods are removed or
    reset and its zones deleted, and the partner's decline notes replaced
    (``dispatch.retention``); the GPS points they recorded are cleared
    except on orders still needed as evidence (``deliveries.retention``);
    their in-app notifications are deleted; the staff reason on the audit
    rows of decisions about them (approved, suspended, activated,
    deactivated) is replaced by a ``reason_removed`` marker, because a
    free-text note can name them (NFR-003, #298); and an audit row is
    written. Assignments, pickups, proofs, incidents, cash records, the audit
    rows themselves (actor, time, action, other details) and the approval
    status are kept.

    Args:
        session: Database session.
        actor: The admin running it (:func:`get_acting_admin`).
        partner_phone: The partner's normalized phone.
        now: Time of the change.
        apply: Save the changes; otherwise roll them back (dry run).

    Returns:
        What changed.

    Raises:
        LookupError: No rider or driver account has this phone.
        PartnerNotReady: A live job, unsettled cash, or an open matter or
            dispute on one of their jobs.
    """
    partner = await accounts.get_partner(session, phone=partner_phone)
    partner_id = partner.id
    worked = await jobs.worked_order_ids(session, driver_id=partner_id)

    blockers = await jobs.live_job_references(session, driver_id=partner_id)
    blockers += await payments.driver_cash_blockers(session, driver_id=partner_id)
    open_matters = await deliveries.open_matter_order_ids(session, order_ids=worked)
    blockers += [
        f"{reference}: open hold or review"
        for reference in await orders.order_references(session, order_ids=open_matters)
    ]
    disputed = set(await orders.disputed_order_ids(session)) & set(worked)
    blockers += [
        f"{reference}: disputed"
        for reference in await orders.order_references(session, order_ids=disputed)
    ]
    if blockers:
        raise PartnerNotReady(sorted(blockers))

    notes = await deliveries.count_partner_notes(session, driver_id=partner_id)
    marker = await accounts.new_phone_marker(session)
    await accounts.anonymize_account(
        session, partner, phone_marker=marker, name=accounts.ANONYMIZED_PARTNER_NAME
    )
    zones = await jobs.clear_profile(session, driver_id=partner_id)
    declines = await jobs.clear_decline_notes(session, driver_id=partner_id)
    gps = await deliveries.clear_partner_gps(
        session, recorded_by=partner_id, keep_order_ids=open_matters | disputed, now=now
    )
    deleted_notes = await notifications.delete_for_users(session, user_ids=[partner_id])
    reasons = await audit.clear_driver_reasons(session, driver_id=partner_id)
    audit.record(
        session,
        actor_id=actor.id,
        action="partner_anonymized",
        target_type="user",
        target_id=partner_id,
        details={
            "zones_removed": zones,
            "decline_notes_removed": declines,
            "gps_points_cleared": gps,
            "notifications_deleted": deleted_notes,
            "reasons_cleared": reasons,
        },
    )
    await _finish(session, apply)
    return PartnerAnonymizeResult(
        partner_id=partner_id,
        zones_removed=zones,
        decline_notes_removed=declines,
        gps_points_cleared=gps,
        notifications_deleted=deleted_notes,
        reasons_cleared=reasons,
        notes_to_review=notes,
        applied=apply,
    )


async def correct_customer_name(
    session: AsyncSession, *, actor: User, customer_phone: str, name: str
) -> uuid.UUID:
    """Correct a customer's account name (procedure "Correction"). Commits.

    The audit row records that the name changed, not the names.

    Args:
        session: Database session.
        actor: The admin running it.
        customer_phone: The customer's normalized phone.
        name: The corrected name, trimmed, 1-100 characters.

    Returns:
        The customer's id.

    Raises:
        LookupError: No customer account has this phone.
    """
    customer = await accounts.get_customer(session, phone=customer_phone)
    accounts.correct_name(customer, name)
    audit.record(
        session,
        actor_id=actor.id,
        action="account_name_corrected",
        target_type="user",
        target_id=customer.id,
    )
    customer_id = customer.id
    await session.commit()
    return customer_id


async def retention_review(
    session: AsyncSession, *, actor: User, now: datetime, apply: bool
) -> ReviewResult:
    """Run the database part of the monthly retention review.

    Procedure "Monthly retention review"; notice section 8. Every step
    selects rows by time ("expired before now", "created before now minus
    the period"), so running it again finds nothing new:

    - expired phone and delivery codes: the hash is blanked, rows kept;
    - ended sessions: deleted;
    - customer accounts never verified, created over 30 days ago and
      without orders: deleted, with their saved addresses. An account that
      audit rows name as the actor (a password change, an address change)
      cannot be deleted without losing those NFR-004 records
      (``audit_logs.actor_id`` is RESTRICT), so it is anonymized and
      deactivated instead, as :func:`anonymize_customer` does (technical
      lead, 2026-10-27, #82). One already anonymized is left alone, so a
      second run changes nothing;
    - GPS points over 90 days old: cleared, except on disputed orders and
      orders with an open hold or review;
    - orders finished over 3 years ago: contact and address removed, as when
      a customer is anonymized;
    - support requests resolved over 3 years ago: deleted (complaints;
      technical lead, 2026-10-27, #82);
    - deletion requests completed or refused over 3 years ago: deleted;
      open ones are never touched (privacy contact, 2026-10-27, #118).

    Support-line messages, server logs, backups and the request register
    are checked by hand (the command lists them).

    Args:
        session: Database session.
        actor: The admin running it.
        now: The review's time.
        apply: Save the changes; otherwise roll them back (dry run).

    Returns:
        How many rows each step changed.
    """
    phone_codes = await accounts.clear_expired_phone_codes(session, now=now)
    delivery_codes = await deliveries.clear_expired_delivery_codes(session, now=now)
    sessions_deleted = await accounts.delete_ended_sessions(session, now=now)

    unverified = await accounts.unverified_customer_ids(
        session, created_before=now - UNVERIFIED_ACCOUNT_PERIOD
    )
    with_orders = await orders.customers_with_orders(session, customer_ids=unverified)
    due = [user_id for user_id in unverified if user_id not in with_orders]
    actors = await audit.actors_with_rows(session, user_ids=due)
    to_delete = [user_id for user_id in due if user_id not in actors]
    await addresses.delete_addresses(session, customer_ids=due)
    await addresses.delete_requests(session, customer_ids=to_delete)
    accounts_deleted = await accounts.delete_accounts(session, user_ids=to_delete)
    accounts_anonymized = 0
    for user in await accounts.get_users(session, user_ids=actors):
        if accounts.is_anonymized_phone(user.phone):
            continue
        marker = await accounts.new_phone_marker(session)
        await accounts.anonymize_account(session, user, phone_marker=marker)
        await addresses.clear_requests(session, customer_ids=[user.id])
        await notifications.delete_for_users(session, user_ids=[user.id])
        accounts_anonymized += 1
    support_deleted = await addresses.delete_resolved_support_requests(
        session, resolved_before=years_before(now, COMPLAINT_PERIOD_YEARS)
    )
    deletion_deleted = await addresses.delete_handled_deletion_requests(
        session, handled_before=years_before(now, DELETION_REQUEST_PERIOD_YEARS)
    )

    keep = set(await orders.disputed_order_ids(session))
    keep |= await deliveries.open_matter_order_ids(session)
    gps = await deliveries.clear_old_gps(
        session, recorded_before=now - GPS_PERIOD, keep_order_ids=keep, now=now
    )

    old_orders = await orders.completed_order_ids(
        session, completed_before=years_before(now, ORDER_PERIOD_YEARS)
    )
    anonymized = await orders.anonymize_orders(session, order_ids=old_orders, now=now)
    gps += await deliveries.clear_order_gps(session, order_ids=old_orders, now=now)

    result = ReviewResult(
        phone_codes_cleared=phone_codes,
        delivery_codes_cleared=delivery_codes,
        sessions_deleted=sessions_deleted,
        unverified_accounts_deleted=accounts_deleted,
        unverified_accounts_anonymized=accounts_anonymized,
        gps_points_cleared=gps,
        orders_anonymized=anonymized,
        support_requests_deleted=support_deleted,
        deletion_requests_deleted=deletion_deleted,
        applied=apply,
    )
    audit.record(
        session,
        actor_id=actor.id,
        action="retention_review_applied",
        target_type="retention_review",
        # One id per run, so the register can point at its audit row.
        target_id=uuid.uuid4(),
        details={name: count for name, count in asdict(result).items() if name != "applied"},
    )
    await _finish(session, apply)
    return result


async def set_deletion_request_status(
    session: AsyncSession,
    *,
    actor: User,
    reference: str,
    status: DeletionRequestStatus,
    reason: str | None,
    now: datetime,
) -> uuid.UUID:
    """Record the outcome of a customer's deletion request (contract decision 10). Commits.

    The rules are in :func:`app.modules.customers.requests.set_deletion_status`:
    ``received`` → ``acknowledged`` → ``completed``; ``refused`` from either
    open status, with a reason; ``completed`` only once the account is
    anonymized (``anonymize-customer --apply``). The audit row names the new
    status, never the reason.

    Args:
        session: Database session.
        actor: The admin running it.
        reference: The request's ``DR-`` reference.
        status: ``acknowledged``, ``completed`` or ``refused``.
        reason: The refusal reason (trimmed, 5-500 characters), or None.
        now: Time of the change.

    Returns:
        The request's id.

    Raises:
        LookupError: No request has this reference.
        DeletionStatusRefused: The change breaks a rule; nothing is saved.
    """
    request = await customer_requests.get_deletion_request_for_update(session, reference=reference)
    owners = await accounts.get_users(session, user_ids=[request.user_id])
    anonymized = bool(owners) and accounts.is_anonymized_phone(owners[0].phone)
    try:
        customer_requests.set_deletion_status(
            request,
            status=status,
            handled_by=actor.id,
            now=now,
            refusal_reason=reason,
            account_anonymized=anonymized,
        )
    except customer_requests.DeletionStatusRefused:
        await session.rollback()
        raise
    audit.record(
        session,
        actor_id=actor.id,
        action=f"deletion_request_{status.value}",
        target_type="deletion_request",
        target_id=request.id,
    )
    request_id = request.id
    await session.commit()
    return request_id
