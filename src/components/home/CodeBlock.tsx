import { cn } from '~/lib/utils'
import { CopyButton } from './CopyButton'

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border border-border bg-muted/40', className)}>
      <pre className="overflow-x-auto p-4 pr-14 font-mono text-xs leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2 opacity-70 transition-opacity group-hover:opacity-100">
        <CopyButton text={code} variant="ghost" />
      </div>
    </div>
  )
}
