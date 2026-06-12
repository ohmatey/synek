import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Clock,
  Database,
  GitBranch,
  KeyRound,
  Network,
  Quote,
  Sparkles,
  Undo2,
  UserPlus,
  Workflow,
  Zap,
} from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { HeroPreview } from './HeroPreview'
import { SiteFooter } from './SiteFooter'

const STEPS = [
  {
    icon: UserPlus,
    title: 'Create an account',
    body: 'A local account holds your timelines and API keys. No cloud, no team setup — just you.',
  },
  {
    icon: KeyRound,
    title: 'Generate an API key',
    body: 'Mint a bearer token in one click. It’s how your MCP client authenticates to the canvas.',
  },
  {
    icon: Workflow,
    title: 'Connect your MCP client',
    body: 'Point Claude Desktop or Claude Code at the endpoint and ask it to build. Watch nodes appear.',
  },
]

const FEATURES = [
  {
    icon: Network,
    title: 'Typed nodes & relationships',
    body: 'Events, entities, people and periods — wired into a visual mesh of meaning, not just a list.',
    tint: 'text-dialogue',
  },
  {
    icon: Clock,
    title: 'Time-anchored',
    body: 'Every node sits on a real instant — from “Q3 2008” to “49 BCE”. The axis is the truth.',
    tint: 'text-primary',
  },
  {
    icon: Undo2,
    title: 'One edit, one undo',
    body: 'Every change — yours or the model’s — commits as a single atomic Patch. ⌘Z always works.',
    tint: 'text-story',
  },
  {
    icon: Database,
    title: 'Local-first, your data',
    body: 'SQLite on your machine. No hosted model. Optional, anonymous usage analytics — off with one switch.',
    tint: 'text-success',
  },
  {
    icon: Zap,
    title: 'MCP-native',
    body: 'The app holds no AI. Bring your own model through an open Model Context Protocol server.',
    tint: 'text-influence',
  },
  {
    icon: Quote,
    title: 'Cite freely',
    body: 'Clients are encouraged to source every claim. Citations live right on the node.',
    tint: 'text-dialogue',
  },
]

export function Landing() {
  return (
    <div className="relative overflow-clip">
      {/* Hero ------------------------------------------------------------ */}
      <section className="relative isolate px-6 pt-20 pb-16 sm:pt-28 md:pb-24">
        <div className="lp-aurora">
          <span />
          <span />
          <span />
        </div>
        <div className="lp-grid" />

        <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
          <Badge
            variant="soft"
            className="gap-1.5 rounded-full border-border/60 bg-card/60 px-3 py-1 backdrop-blur"
          >
            <Sparkles className="size-3.5 text-story" />
            Local-first · MCP-native · no AI in the app
          </Badge>

          <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            A timeline canvas{' '}
            <span className="lp-grad lp-grad-anim">your AI builds for you.</span>
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Synek holds no model of its own. Connect your MCP client, and it weaves a living,
            time-anchored mesh of events, people and ideas. The canvas is the viewer — your client
            brings the mind.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="group h-11 px-6 text-[15px]">
              <Link to="/signup">
                Start building — it’s free
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-6 text-[15px]">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>

          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground/80">
            <span>Bring your own model</span>
            <Dot />
            <span>Your data stays local</span>
            <Dot />
            <span>One undoable edit at a time</span>
          </p>
        </div>

        {/* Switchable live-timeline "app window" */}
        <HeroPreview />
      </section>

      {/* How it works --------------------------------------------------- */}
      <section id="how-it-works" className="relative mx-auto max-w-5xl scroll-mt-20 px-6 py-16 md:py-24">
        <SectionHeading
          eyebrow="Three steps"
          title="From empty canvas to living history"
          sub="Setup takes a minute. Everything after that, your model does for you."
        />
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="lp-reveal lp-lift relative rounded-xl border border-border bg-card p-6"
            >
              <span className="absolute right-5 top-5 font-mono text-sm text-muted-foreground/50">
                0{i + 1}
              </span>
              <span className="inline-flex size-10 items-center justify-center rounded-lg border border-border bg-background text-primary">
                <s.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features ------------------------------------------------------- */}
      <section id="features" className="relative scroll-mt-20 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            eyebrow="Why Synek"
            title="A canvas with opinions"
            sub="Built around one idea: structured, sourced, time-anchored knowledge that you and your model can both trust."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="lp-reveal lp-lift group rounded-xl border border-border bg-card p-6 hover:border-primary/40 hover:shadow-lg"
              >
                <span
                  className={`inline-flex size-10 items-center justify-center rounded-lg border border-border bg-background ${f.tint}`}
                >
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA ------------------------------------------------------ */}
      <section id="get-started" className="relative scroll-mt-20 px-6 py-20 md:py-28">
        <div className="lp-aurora opacity-40" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="lp-reveal relative mx-auto max-w-2xl text-center">
          <Badge variant="soft" className="rounded-full">
            <GitBranch className="size-3.5" />
            Open the canvas
          </Badge>
          <h2 className="mt-5 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Bring your own model. <span className="lp-grad">Build your first timeline.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty leading-relaxed text-muted-foreground">
            Create an account, mint a key, and point your MCP client at the endpoint. Then just ask —{' '}
            <em className="text-foreground/90">“map the history of observability tooling”</em> — and
            watch the canvas fill in.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="group h-11 px-6 text-[15px]">
              <Link to="/signup">
                Create your account
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-6 text-[15px]">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <p className="mt-5 text-xs text-muted-foreground/80">
            No credit card · no hosted AI · works with Claude Desktop &amp; Claude Code
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}

function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="lp-reveal mx-auto max-w-2xl text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
        {eyebrow}
      </span>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  )
}

function Dot() {
  return <span aria-hidden className="size-1 rounded-full bg-muted-foreground/40" />
}
