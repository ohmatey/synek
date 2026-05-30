import { createFileRoute } from '@tanstack/react-router'
import { ClientOnly } from '@strata/ui'
import { useSession } from '~/lib/auth/client'
import { AppHeader, Landing, SignedIn } from '~/components/home'

export const Route = createFileRoute('/')({
  component: Home,
})

function HomeBody() {
  const { data: session, isPending } = useSession()
  if (isPending)
    return (
      <p className="mx-auto w-full max-w-5xl px-6 py-10 text-sm text-[var(--color-fg-muted)]">
        Loading…
      </p>
    )
  return session?.user ? <SignedIn /> : <Landing />
}

function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg-base)] text-[var(--color-fg-primary)]">
      <AppHeader />
      <main className="flex-1">
        <ClientOnly
          fallback={
            <p className="mx-auto w-full max-w-5xl px-6 py-10 text-sm text-[var(--color-fg-muted)]">
              Loading…
            </p>
          }
        >
          <HomeBody />
        </ClientOnly>
      </main>
    </div>
  )
}
