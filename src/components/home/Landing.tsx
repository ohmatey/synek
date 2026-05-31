import { AuthForms } from './AuthForms'

export function Landing() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-12 px-6 py-16 md:grid-cols-[1.2fr_1fr] md:items-start md:py-24">
      <div>
        <h2 className="text-3xl font-semibold leading-tight tracking-tight text-[var(--color-fg-primary)] md:text-4xl">
          A timeline canvas your AI builds for you.
        </h2>
        <p className="mt-4 max-w-prose text-base text-[var(--color-fg-secondary)] leading-relaxed">
          Synek holds no AI of its own. Connect your MCP client (Claude Desktop, Claude Code) with
          an API key and ask it to build and edit a visual, time-anchored mesh of events, people,
          and ideas. The canvas is the viewer; your client brings the model.
        </p>
        <ol className="mt-8 flex flex-col gap-3">
          {[
            'Create an account',
            'Generate an API key',
            'Connect your MCP client & start building',
          ].map((step, i) => (
            <li key={step} className="flex items-center gap-3 text-sm text-[var(--color-fg-primary)]">
              <span
                aria-hidden
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-xs font-semibold text-[var(--color-accent-primary)]"
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
      <AuthForms />
    </div>
  )
}
