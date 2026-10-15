# Mock API samples

Sample responses matching the contracts in [../auth.md](../auth.md),
[../orders.md](../orders.md) and [../deliveries.md](../deliveries.md), for
building UI before the endpoints exist (S1-05, S1-09). All people, phone numbers
and addresses are fictional, and every record is marked `is_simulated: true`
where the field exists.

The delivery samples (`assignment.json`, `error-invalid-order-transition.json`,
`error-delivery-proof-required.json`) follow a **proposed** contract: their
shapes may change until deliveries.md is agreed (G3).

`backend/tests/test_api_examples.py` checks that every file here is valid JSON,
that error samples use the shared error envelope, and that statuses are ones the
contracts define.

There are no prices: Sprint 1 orders are quote requests (see
[../orders.md](../orders.md#why-sprint-1-orders-have-no-price)).

If a contract changes, update these files in the same PR.
