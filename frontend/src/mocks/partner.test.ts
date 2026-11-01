// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockLogin, mockLogout } from './authMock'
import { createOrder, getOrder } from './customerMock'
import { resetMockDb } from './db'
import {
  acceptJob,
  arriveAtCustomer,
  completeUnloading,
  confirmPickup,
  declineJob,
  failUnreachable,
  getEarnings,
  listAvailableJobs,
  listMyActiveJobs,
  listSignupAreas,
  MOCK_UNREACHABLE_WAIT_MS,
  partnerSignup,
  recordContactAttempt,
  resendCode,
  setOnline,
  startUnloading,
  verifyCode,
} from './partnerMock'
import { DEMO_PASSWORD } from './seed'

const RIDER = { phone: '0800 000 0101', password: DEMO_PASSWORD }
const DRIVER = { phone: '0800 000 0102', password: DEMO_PASSWORD }
const loaded = { loaded: true, receipt: true, photo_url: null, gallons_loaded: null }

beforeEach(() => resetMockDb())
afterEach(() => vi.restoreAllMocks())

describe('partner pool', () => {
  it('shows riders only Keke orders and tanker drivers only tanker orders that fit their tank', async () => {
    await mockLogin(RIDER)
    const keke = await listAvailableJobs()
    expect(keke.length).toBeGreaterThan(0)
    expect(keke.every((j) => j.choice?.delivery_type === 'keke')).toBe(true)
    await mockLogout()
    await mockLogin(DRIVER)
    const tank = await listAvailableJobs()
    expect(tank.length).toBeGreaterThan(0)
    expect(tank.every((j) => j.choice?.delivery_type === 'tanker' && (j.choice.tank_size_gallons ?? 0) <= 1000)).toBe(true)
  })

  it('is empty while offline', async () => {
    await mockLogin(RIDER)
    await setOnline(false)
    expect(await listAvailableJobs()).toEqual([])
  })

  it('hides server-only fields', async () => {
    await mockLogin(RIDER)
    const [job] = await listAvailableJobs()
    expect(job).not.toHaveProperty('partner_id')
    expect(job).not.toHaveProperty('mock_code')
  })

  it('new partners wait for approval and cannot go online', async () => {
    await partnerSignup({ name: 'New', phone: '0809 000 0099', password: 'long-enough', vehicle_type: 'keke', plate: 'ENU 1 KK', tank_gallons: null, service_zone_id: (await listSignupAreas())[0].id })
    await expect(setOnline(true)).rejects.toMatchObject({ code: 'partner_not_approved' })
    expect(await listAvailableJobs()).toEqual([])
  })
})

describe('partner sign-up areas', () => {
  const input = { name: 'New', phone: '0809 000 0097', password: 'long-enough', vehicle_type: 'keke' as const, plate: 'ENU 3 KK', tank_gallons: null }

  it('lists the enabled areas by name, and the sign-up stores the chosen one', async () => {
    const areas = await listSignupAreas()
    expect(areas.length).toBeGreaterThan(0)
    const session = await partnerSignup({ ...input, service_zone_id: areas[0].id })
    expect(session.user.role).toBe('driver')
  })

  it('refuses an unknown area with a validation error on service_zone_id', async () => {
    await expect(partnerSignup({ ...input, service_zone_id: 'no-such-zone' })).rejects.toMatchObject({
      code: 'validation_error',
      details: [{ loc: ['body', 'service_zone_id'] }],
    })
  })
})

describe('accept, decline, pickup, code', () => {
  it('gives an order to the first partner who accepts', async () => {
    await mockLogin(RIDER)
    const [job] = await listAvailableJobs()
    const mine = await acceptJob(job.reference)
    expect(mine.stage).toBe('accepted')
    await mockLogout()
    await partnerSignup({ name: 'Second', phone: '0809 000 0098', password: 'long-enough', vehicle_type: 'keke', plate: 'ENU 2 KK', tank_gallons: null, service_zone_id: (await listSignupAreas())[0].id })
    await expect(acceptJob(job.reference)).rejects.toMatchObject({ code: 'partner_not_approved' })
  })

  it('declines only an assigned order, and puts it back in the pool without offering it again', async () => {
    await mockLogin(RIDER)
    const assigned = (await listMyActiveJobs()).find((j) => j.stage === 'assigned')!
    const [pool] = await listAvailableJobs()
    await expect(declineJob(pool.reference, 'not_available', '')).rejects.toMatchObject({ code: 'not_assigned_to_you' })
    await declineJob(assigned.reference, 'outside_area', 'Too far')
    expect((await listMyActiveJobs()).some((j) => j.reference === assigned.reference)).toBe(false)
    expect((await listAvailableJobs()).some((j) => j.reference === assigned.reference)).toBe(false)
  })

  it('needs the load confirmed before leaving the station', async () => {
    await mockLogin(RIDER)
    const [job] = await listAvailableJobs()
    await acceptJob(job.reference)
    await expect(confirmPickup(job.reference, { ...loaded, loaded: false })).rejects.toMatchObject({ code: 'load_not_confirmed' })
    expect((await confirmPickup(job.reference, loaded)).stage).toBe('collected')
  })

  it('needs the full gallons loaded for a tanker', async () => {
    await mockLogin(DRIVER)
    const job = (await listAvailableJobs()).find((j) => j.choice?.delivery_type === 'tanker' && j.choice.tank_size_gallons === 750)!
    await acceptJob(job.reference)
    await expect(confirmPickup(job.reference, { ...loaded, gallons_loaded: 600 })).rejects.toMatchObject({ code: 'load_not_confirmed' })
    expect((await confirmPickup(job.reference, { ...loaded, gallons_loaded: 750 })).stage).toBe('collected')
  })

  it('issues the code only once unloading is done (#13)', async () => {
    await mockLogin(RIDER)
    const [job] = await listAvailableJobs()
    await acceptJob(job.reference)
    const collected = await confirmPickup(job.reference, loaded)
    expect([collected.code_tries_left, collected.demo_code]).toEqual([null, undefined])
    await expect(verifyCode(job.reference, '000000')).rejects.toMatchObject({ code: 'transition_requirements_unmet', details: { missing: ['unloading_confirmed'] } })
    await expect(resendCode(job.reference)).rejects.toMatchObject({ code: 'transition_requirements_unmet' })
    const unloaded = await completeUnloading(job.reference)
    expect(unloaded.code_tries_left).toBe(3)
    expect(unloaded.demo_code).toMatch(/^\d{6}$/)
    expect((await completeUnloading(job.reference)).demo_code).toBe(unloaded.demo_code)
    expect((await verifyCode(job.reference, unloaded.demo_code!)).stage).toBe('delivered')
  })

  it('refuses unloading before pickup', async () => {
    await mockLogin(RIDER)
    const [job] = await listAvailableJobs()
    await acceptJob(job.reference)
    await expect(completeUnloading(job.reference)).rejects.toMatchObject({ code: 'invalid_job_transition' })
  })

  it('counts wrong codes down and locks after three', async () => {
    await mockLogin(RIDER)
    const active = (await listMyActiveJobs()).find((j) => j.stage === 'collected')!
    await expect(verifyCode(active.reference, '000000')).rejects.toMatchObject({ code: 'invalid_code', details: { tries_left: 2 } })
    await expect(verifyCode(active.reference, '000001')).rejects.toMatchObject({ details: { tries_left: 1 } })
    await expect(verifyCode(active.reference, '000002')).rejects.toMatchObject({ code: 'code_locked' })
    await expect(verifyCode(active.reference, '482791')).rejects.toMatchObject({ code: 'code_locked' })
  })

  it('completes with the customer code, pays the partner and updates the customer order', async () => {
    await mockLogin(RIDER)
    const before = (await getEarnings()).wallet_minor_units
    const done = await verifyCode('MO-7KQ2M9XH4T', '482791')
    expect(done.stage).toBe('delivered')
    expect((await getEarnings()).wallet_minor_units).toBe(before + (done.earning_minor_units ?? 0))
    await mockLogout()
    await mockLogin({ phone: '0803 123 4567', password: DEMO_PASSWORD })
    const order = await getOrder('MO-7KQ2M9XH4T')
    expect(order.stage).toBe('delivered')
    expect(order.delivery_code).toBeNull()
  })

  it('offers a new customer order to riders, and the customer sees the rider once accepted', async () => {
    await mockLogin({ phone: '0803 123 4567', password: DEMO_PASSWORD })
    const order = await createOrder({
      idempotency_key: 'k-new',
      choice: { delivery_type: 'keke', can_size_litres: 25, can_count: 12 },
      address_label: 'Home',
      address: '12 Lakeview Street, GRA, Enugu',
      landmark: null,
      receiver_name: 'Adaeze Nwosu',
      receiver_phone: '0803 123 4567',
      instructions: null,
    })
    await mockLogout()
    await mockLogin(RIDER)
    expect((await listAvailableJobs()).some((j) => j.reference === order.reference)).toBe(true)
    await acceptJob(order.reference)
    await mockLogout()
    await mockLogin({ phone: '0803 123 4567', password: DEMO_PASSWORD })
    const seen = await getOrder(order.reference)
    expect(seen.stage).toBe('rider_assigned')
    expect(seen.partner?.name).toBe('Chinedu Okafor')
  })
})

describe('arrival and the unreachable customer (#250, FR-038)', () => {
  /** A rider's job, picked up and on its way to the customer. */
  async function onTheWay() {
    await mockLogin(RIDER)
    const [job] = await listAvailableJobs()
    await acceptJob(job.reference)
    await confirmPickup(job.reference, loaded)
    return job.reference
  }

  /** Move the clock past the mock's wait since arrival. */
  function afterTheWait() {
    const real = Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => real() + MOCK_UNREACHABLE_WAIT_MS + 1000)
  }

  it('refuses attempts, unloading and failing before arrival', async () => {
    const ref = await onTheWay()
    await expect(recordContactAttempt(ref)).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
    await expect(startUnloading(ref)).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
    await expect(failUnreachable(ref)).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
  })

  it('stamps the arrival once, with the earliest time to end the job, and offers the actions as the server would', async () => {
    const ref = await onTheWay()
    const arrived = await arriveAtCustomer(ref)
    expect(Date.parse(arrived.unreachable_allowed_at!) - Date.parse(arrived.arrived_at!)).toBe(MOCK_UNREACHABLE_WAIT_MS)
    expect([arrived.contact_attempts, arrived.can_start_unloading, arrived.can_fail_unreachable]).toEqual([[], true, false])
    expect((await arriveAtCustomer(ref)).arrived_at).toBe(arrived.arrived_at)
  })

  it('records every attempt and keeps the end action off until two attempts and the wait', async () => {
    const ref = await onTheWay()
    await arriveAtCustomer(ref)
    expect((await recordContactAttempt(ref)).contact_attempts).toHaveLength(1)
    await expect(failUnreachable(ref)).rejects.toMatchObject({
      code: 'transition_requirements_unmet',
      details: { missing: ['contact_attempts_recorded', 'unreachable_wait_elapsed'] },
    })
    const two = await recordContactAttempt(ref)
    expect([two.contact_attempts?.length, two.can_fail_unreachable]).toEqual([2, false])
    await expect(failUnreachable(ref)).rejects.toMatchObject({ code: 'transition_requirements_unmet', details: { missing: ['unreachable_wait_elapsed'] } })
    afterTheWait()
    const third = await recordContactAttempt(ref)
    expect([third.contact_attempts?.length, third.can_fail_unreachable]).toEqual([3, true])
  })

  it('ends the job as failed once both conditions are met', async () => {
    const ref = await onTheWay()
    await arriveAtCustomer(ref)
    await recordContactAttempt(ref)
    await recordContactAttempt(ref)
    afterTheWait()
    const failed = await failUnreachable(ref)
    expect([failed.stage, failed.end_reason]).toEqual(['failed', 'customer_unreachable'])
    expect(Date.parse(failed.ended_at!)).not.toBeNaN()
    await expect(recordContactAttempt(ref)).rejects.toMatchObject({ code: 'invalid_order_transition' })
  })

  it('turns "Start unloading" off once unloading has started, and then refuses more attempts', async () => {
    const ref = await onTheWay()
    await arriveAtCustomer(ref)
    const started = await startUnloading(ref)
    expect([started.can_start_unloading, started.can_fail_unreachable]).toEqual([false, false])
    await expect(recordContactAttempt(ref)).rejects.toMatchObject({ code: 'invalid_order_transition' })
  })
})
