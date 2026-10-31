# 2026-10-31: The mock admin order timeline repeated its lines on every read

- **Area:** frontend
- **Author:** Bonvee120 + agent
- **Symptom:** A new test for the contact-attempt lines (#280) read a failed mock order twice and found "Delivery failed" twice in its timeline: `['...', 'Contact attempt 2', 'Delivery failed', 'Delivery failed']`. Each further read of the same order added another one.
- **Cause:** The mock's order view (`mocks/adminMock.ts`) built the timeline with `const timeline = o?.timeline ?? [...]` and then pushed the hold, withdrawal and ending lines onto it. For an order that has a customer order, `o.timeline` is the stored array, so every read changed the stored data and appended the lines again.
- **Fix / workaround:** The view now copies the array before it adds lines. A test reads the order twice and checks each line once. Not seen in the real adapter, which builds a new list from the history on every read.
- **Status:** resolved
- **Refs:** #280, `frontend/src/mocks/adminMock.ts`, `frontend/src/mocks/admin.test.ts`
