import { useState } from 'react'
import { Button, type ButtonProps } from '@strata/ui'

interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  text: string
  label?: string
  copiedLabel?: string
}

/** Copies `text` to clipboard on click; flips label to "Copied" for 1.5s. */
export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  size = 'sm',
  variant = 'secondary',
  ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      {...rest}
    >
      {copied ? copiedLabel : label}
    </Button>
  )
}
