import { cn } from '@synek/ui'
import { CopyButton } from './CopyButton'

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div
      className={cn(
        'relative rounded-[var(--radius-control)] border border-[var(--color-border-default)] bg-[var(--color-bg-base)]',
        className,
      )}
    >
      <pre className="overflow-x-auto p-4 pr-20 text-xs leading-relaxed text-[var(--color-fg-primary)] font-mono">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton text={code} size="sm" variant="ghost" />
      </div>
    </div>
  )
}
