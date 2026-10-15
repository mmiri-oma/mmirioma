import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { TextAreaField } from '../../../components/ui/TextAreaField'
import type { Session } from '../../../lib/api/auth'
import { ApiError } from '../../../lib/api/client'
import type { OrderCreate } from '../../../lib/api/orders'
import { BackToOrders } from '../components/BackToOrders'
import { CustomerLayout } from '../components/CustomerLayout'
import { ErrorSummary } from '../components/ErrorSummary'
import { QuantityTiles } from '../components/QuantityTiles'
import { ORDER_TEXT } from '../messages'
import { useRequestDraftStore, type RequestDraft } from '../requestDraft'
import {
  FIELD_LABELS,
  FIELD_LIMITS,
  FIELD_ORDER,
  emptyRequestValues,
  lagosToday,
  newIdempotencyKey,
  requestSchema,
  serverFieldErrors,
  toOrderCreate,
  type RequestField,
  type RequestFormValues,
} from '../requestForm'
import { useCustomerOrdersSource } from '../source'
import { customerOrdersKey } from '../useCustomerOrders'
import type { MyOrdersLocationState } from './MyOrdersPage'
import type { RequestReceivedLocationState } from './RequestReceivedPage'

/** Why the last "Send request" failed without field errors. */
type SendProblem =
  /** No connection or a server error (O2-e): Retry. */
  | { kind: 'network' }
  /** 403 `csrf_failed` (O2-g, X3): Reload. */
  | { kind: 'security' }
  /** Anything else: the server's own message. */
  | { kind: 'other'; message: string }

/** Element id of each field's control, for labels and error summary links. */
const fieldId = (field: RequestField) => `request-${field}`

/**
 * O2 Request water. Opens the unsent draft for this account if there is one
 * (Decision 10), otherwise a new form with the receiver prefilled and a new
 * idempotency key (Decision 9).
 */
export function RequestWaterPage({ session }: { session: Session }) {
  const store = useRequestDraftStore()
  // Read once when the form opens; later saves must not reset the form.
  const [initial] = useState<RequestDraft>(
    () =>
      store.read(session.user.id) ?? {
        ownerId: session.user.id,
        values: emptyRequestValues(session.user),
        idempotencyKey: newIdempotencyKey(),
      },
  )
  return (
    <CustomerLayout user={session.user}>
      <RequestForm draft={initial} />
    </CustomerLayout>
  )
}

/**
 * The request form (`POST /orders`).
 *
 * - Client checks first; on failure the error summary takes focus and nothing
 *   is sent.
 * - While sending, every field is locked with its value visible and extra
 *   taps are ignored (NFR-022).
 * - One idempotency key for the life of the form (Decision 9): a retry after
 *   any failure reuses it, so a request that reached the server is never
 *   created twice (FR-026, T-06).
 * - Every value is kept on failure (NFR-012) and saved to the in-memory draft
 *   as it is typed, so it survives the session ending (X2).
 */
function RequestForm({ draft }: { draft: RequestDraft }) {
  const source = useCustomerOrdersSource()
  const store = useRequestDraftStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const today = useMemo(() => lagosToday(), [])

  const {
    register,
    handleSubmit,
    control,
    setError,
    subscribe,
    formState: { errors },
  } = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema(today)),
    defaultValues: draft.values,
  })

  const [problem, setProblem] = useState<SendProblem | null>(null)
  const [summaryShown, setSummaryShown] = useState(false)
  // Bumped to move focus after a failed send (summary or problem banner).
  const [focusRequest, setFocusRequest] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)
  const problemRef = useRef<HTMLDivElement>(null)
  // Guards against a second send in the same tick, before `isPending` renders.
  const sendingRef = useRef(false)

  // Save every change to the in-memory draft. No re-render is needed: the
  // draft is read only when a form opens. Unsubscribes on unmount.
  useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ values }) =>
          store.save({
            ownerId: draft.ownerId,
            values: values as RequestFormValues,
            idempotencyKey: draft.idempotencyKey,
          }),
      }),
    [subscribe, store, draft.ownerId, draft.idempotencyKey],
  )

  // Move focus once the summary or banner for a failed send has rendered.
  useEffect(() => {
    if (focusRequest === 0) return
    const target = problemRef.current ?? summaryRef.current
    target?.focus()
    target?.scrollIntoView?.({ block: 'start' })
  }, [focusRequest])

  const mutation = useMutation({
    mutationFn: (body: OrderCreate) => source.createOrder(body),
  })
  const locked = mutation.isPending

  const quantityChoice = useWatch({ control, name: 'quantityChoice' })
  const addressLength = useWatch({ control, name: 'deliveryAddress' }).length

  const showFailure = (next: SendProblem) => {
    setProblem(next)
    setFocusRequest((count) => count + 1)
  }

  const handleFailure = (error: unknown, values: RequestFormValues) => {
    if (!(error instanceof ApiError)) {
      showFailure({ kind: 'network' })
      return
    }
    switch (error.code) {
      case 'idempotency_key_reused': {
        // An earlier send from this form was stored: the request exists.
        // Never send it again with a new key (Decision 9).
        store.clear()
        void queryClient.invalidateQueries({ queryKey: customerOrdersKey(draft.ownerId) })
        const state: MyOrdersLocationState = { alreadyReceived: true }
        navigate('/', { state })
        return
      }
      case 'validation_error': {
        const fieldErrors = serverFieldErrors(error, values.quantityChoice)
        const fields = Object.keys(fieldErrors) as RequestField[]
        if (fields.length === 0) {
          showFailure({ kind: 'other', message: error.message })
          return
        }
        for (const field of fields) setError(field, { message: fieldErrors[field] })
        setSummaryShown(true)
        setFocusRequest((count) => count + 1)
        return
      }
      case 'csrf_failed':
        showFailure({ kind: 'security' })
        return
      case 'not_authenticated':
        // The session ended. The global handler re-checks it and the route
        // guard shows sign-in with "What you typed is kept" (X2).
        return
      default:
        if (error.kind === 'http' && error.status !== null && error.status < 500) {
          showFailure({ kind: 'other', message: error.message })
        } else {
          showFailure({ kind: 'network' })
        }
    }
  }

  // Built when the form is submitted, not during render, because the send
  // handler reads `sendingRef`.
  const send = (event?: FormEvent) =>
    handleSubmit(sendValues, showInvalid)(event)

  async function sendValues(values: RequestFormValues) {
    if (sendingRef.current) return
    sendingRef.current = true
    setProblem(null)
    setSummaryShown(false)
    try {
      const order = await mutation.mutateAsync(toOrderCreate(values, draft.idempotencyKey))
      store.clear()
      void queryClient.invalidateQueries({ queryKey: customerOrdersKey(draft.ownerId) })
      // Replace the form in history, so Back returns to My orders and never
      // to a filled form that could be sent again (O3 note 4).
      const state: RequestReceivedLocationState = { order }
      navigate('/request/received', { replace: true, state })
    } catch (error) {
      handleFailure(error, values)
    } finally {
      sendingRef.current = false
    }
  }

  /** Client checks failed: show the error summary and move focus to it. */
  function showInvalid() {
    setProblem(null)
    setSummaryShown(true)
    setFocusRequest((count) => count + 1)
  }

  const summaryItems = FIELD_ORDER.filter((field) => errors[field]?.message).map((field) => ({
    targetId: fieldId(field),
    label: FIELD_LABELS[field],
  }))

  return (
    <form noValidate onSubmit={send} className="flex flex-col tablet:gap-5" aria-busy={locked}>
      <div className="flex flex-col gap-4 pb-5">
        <BackToOrders />
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">Request water</h1>
          <p className="text-text-secondary">{ORDER_TEXT.requestIntro}</p>
        </div>
        {problem ? (
          <div ref={problemRef} tabIndex={-1} className="outline-none">
            <SendProblemBanner problem={problem} onRetry={() => void send()} />
          </div>
        ) : summaryShown && summaryItems.length > 0 ? (
          <ErrorSummary ref={summaryRef} items={summaryItems} />
        ) : null}
      </div>

      <FormSection>
        <QuantityTiles
          registration={register('quantityChoice')}
          value={quantityChoice}
          error={errors.quantityChoice?.message}
          locked={locked}
          firstId={fieldId('quantityChoice')}
        />
        {quantityChoice === 'other' ? (
          <Field
            id={fieldId('otherLitres')}
            label="Amount"
            inputMode="numeric"
            autoComplete="off"
            help="Whole litres, from 1 to 100,000."
            error={errors.otherLitres?.message}
            locked={locked}
            className="tablet:max-w-[280px]"
            trailing={
              <span className="flex items-center border-l-2 border-border-strong bg-surface-muted px-3.5 font-semibold text-text-secondary">
                litres
              </span>
            }
            {...register('otherLitres')}
          />
        ) : null}
      </FormSection>

      <FormSection title="Where should we deliver?">
        <div className="grid gap-4 tablet:grid-cols-2">
          <Field
            id={fieldId('contactName')}
            label="Receiver's name"
            autoComplete="name"
            maxLength={FIELD_LIMITS.contactName}
            help="The person who will receive the water."
            error={errors.contactName?.message}
            locked={locked}
            {...register('contactName')}
          />
          <Field
            id={fieldId('contactPhone')}
            label="Receiver's phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            leading={<Phone aria-hidden className="size-5" />}
            help="The driver may call this number."
            error={errors.contactPhone?.message}
            locked={locked}
            {...register('contactPhone')}
          />
        </div>
        <TextAreaField
          id={fieldId('deliveryAddress')}
          label="Delivery address"
          autoComplete="street-address"
          maxLength={FIELD_LIMITS.deliveryAddress}
          help="House number, street and area."
          error={errors.deliveryAddress?.message}
          counter={addressLength > 0 ? `${addressLength} / ${FIELD_LIMITS.deliveryAddress}` : undefined}
          locked={locked}
          {...register('deliveryAddress')}
        />
        <Field
          id={fieldId('landmark')}
          label="Landmark"
          optional
          maxLength={FIELD_LIMITS.landmark}
          error={errors.landmark?.message}
          locked={locked}
          {...register('landmark')}
        />
        <TextAreaField
          id={fieldId('deliveryInstructions')}
          label="Delivery instructions"
          optional
          maxLength={FIELD_LIMITS.deliveryInstructions}
          error={errors.deliveryInstructions?.message}
          locked={locked}
          {...register('deliveryInstructions')}
        />
      </FormSection>

      <FormSection title="When?">
        <Field
          id={fieldId('preferredDate')}
          label="Preferred delivery date"
          optional
          type="date"
          min={today}
          help={ORDER_TEXT.dateHelp}
          error={errors.preferredDate?.message}
          locked={locked}
          className="tablet:max-w-[280px]"
          {...register('preferredDate')}
        />
        {errors.preferredDate ? (
          <p className="-mt-2 text-sm leading-5 text-text-secondary">{ORDER_TEXT.dateHelp}</p>
        ) : null}
      </FormSection>

      <FormSection title="Price">
        <p>{ORDER_TEXT.priceNote}</p>
      </FormSection>

      {/* Sticky on phones so the one action stays in thumb reach (Decision 5). */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-surface px-4 py-3 shadow-[0_-4px_12px_-6px_rgb(21_29_35/0.14)] tablet:static tablet:mx-0 tablet:items-start tablet:border-0 tablet:bg-transparent tablet:p-0 tablet:shadow-none">
        <Button type="submit" loading={locked} className="w-full tablet:w-auto">
          {locked ? null : <Send aria-hidden className="size-5" />}
          {locked ? 'Sending request' : 'Send request'}
        </Button>
      </div>
    </form>
  )
}

/** A form section: full-width white band on phones, a card from tablet width. */
function FormSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="-mx-4 flex flex-col gap-4 border-t border-border bg-surface px-4 py-5 tablet:mx-0 tablet:rounded-lg tablet:border tablet:p-6">
      {title ? <h2 className="text-h3">{title}</h2> : null}
      {children}
    </section>
  )
}

/** Banner for a send that failed without field errors (O2-e, O2-g). */
function SendProblemBanner({ problem, onRetry }: { problem: SendProblem; onRetry: () => void }) {
  if (problem.kind === 'security') {
    return (
      <Alert
        tone="error"
        title={ORDER_TEXT.notSent}
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        <p>{ORDER_TEXT.csrfFailed}</p>
      </Alert>
    )
  }
  if (problem.kind === 'other') {
    return (
      <Alert tone="error" title={ORDER_TEXT.notSent}>
        <p>{problem.message}</p>
        <p className="font-semibold">{ORDER_TEXT.typedKept}</p>
      </Alert>
    )
  }
  return (
    <Alert
      tone="error"
      title={ORDER_TEXT.notSent}
      action={
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <p>{ORDER_TEXT.network}</p>
      <p className="font-semibold">{ORDER_TEXT.typedKept}</p>
    </Alert>
  )
}
