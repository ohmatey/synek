import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'

interface CopyButtonProps extends Omit<React.ComponentProps<typeof Button>, 'onClick' | 'children'> {
  text: string
  /** When set, renders an icon + text button; otherwise an icon-only button. */
  label?: string
  copiedLabel?: string
  /** Side effect fired after a successful copy (e.g. an analytics capture). */
  onCopy?: () => void
}

/** Copies `text` to the clipboard; flips to a check + toast for 1.5s. */
export function CopyButton({
  text,
  label,
  copiedLabel = 'Copied',
  size = 'sm',
  variant = 'outline',
  onCopy,
  ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    toast.success('Copied to clipboard')
    onCopy?.()
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      type="button"
      size={label ? size : 'icon'}
      variant={variant}
      onClick={copy}
      aria-label={label ? undefined : 'Copy to clipboard'}
      className={label ? undefined : size === 'sm' ? 'size-8' : undefined}
      {...rest}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {label && (copied ? copiedLabel : label)}
    </Button>
  )
}
