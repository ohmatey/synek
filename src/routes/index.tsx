import { createFileRoute } from '@tanstack/react-router'
import { ClientOnly } from '@synek/ui'
import { Loader2 } from 'lucide-react'
import { useSession } from '~/lib/auth/client'
import { AppHeader, Landing, SignedIn } from '~/components/home'

export const Route = createFileRoute('/')({
  component: Home,
})

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

function HomeBody() {
  const { data: session, isPending } = useSession()
  if (isPending) return <Loading />
  return session?.user ? <SignedIn /> : <Landing />
}

function Home() {
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <AppHeader />
      <main className="flex-1">
        <ClientOnly fallback={<Loading />}>
          <HomeBody />
        </ClientOnly>
      </main>
    </div>
  )
}
