import { Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '../../components/ui/Input'
import { normaliseReference } from './reference'

/** Opens an order directly by its reference, e.g. when a customer calls in. */
export function ReferenceSearch() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  return (
    <form
      role="search"
      noValidate
      className="w-full sm:w-72"
      onSubmit={(event) => {
        event.preventDefault()
        const reference = normaliseReference(value)
        setInvalid(reference === null)
        if (reference) navigate(`/admin/orders/${reference}`)
      }}
    >
      <label htmlFor="reference-search" className="sr-only">
        Find order by reference
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
        <Input
          id="reference-search"
          type="search"
          placeholder="Find by reference, e.g. MO-7KQ2M9XH4T"
          autoComplete="off"
          spellCheck={false}
          value={value}
          invalid={invalid}
          aria-describedby={invalid ? 'reference-search-error' : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
          className="pl-9 font-mono placeholder:font-sans"
        />
      </div>
      {invalid && (
        <p id="reference-search-error" role="alert" className="mt-1 text-xs text-rose-700">
          References look like MO- followed by 10 letters or digits.
        </p>
      )}
    </form>
  )
}
