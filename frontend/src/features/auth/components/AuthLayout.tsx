import type { ReactNode } from 'react'
import { Logo } from '../../../components/ui/Logo'

export interface AuthLayoutProps {
  /** Screen heading, e.g. "Sign in" or "MmiriOma staff". */
  title: string
  children: ReactNode
}

/**
 * Sign-in and account screens (docs/design/authentication.md, Decision 1):
 * full screen on phones; from 768 px, a centred card (440 px, `radius-xl`,
 * `shadow-md`) on the page background.
 */
export function AuthLayout({ title, children }: AuthLayoutProps) {
  return (
    <main className="min-h-svh bg-surface tablet:flex tablet:items-start tablet:justify-center tablet:bg-background tablet:px-6 tablet:py-14">
      <div className="flex w-full flex-col gap-5 px-5 pt-6 pb-7 tablet:max-w-[440px] tablet:rounded-xl tablet:border tablet:border-border tablet:bg-surface tablet:p-8 tablet:shadow-md">
        <Logo className="w-44 tablet:w-55" />
        <h1 className="text-h1">{title}</h1>
        {children}
      </div>
    </main>
  )
}
