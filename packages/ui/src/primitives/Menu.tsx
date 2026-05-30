import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react'
import { cn } from '../utils/cn'

interface MenuContextValue {
  open: boolean
  setOpen: (v: boolean) => void
  rootRef: React.RefObject<HTMLDivElement | null>
}
const Ctx = createContext<MenuContextValue | null>(null)

export interface MenuProps {
  /** Default open state. Use for uncontrolled menus. */
  defaultOpen?: boolean
  /** Controlled open state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  children: ReactNode
}

/**
 * Click-outside + Escape dismissable dropdown menu. Use:
 *   <Menu>
 *     <MenuTrigger>Open</MenuTrigger>
 *     <MenuItem onSelect={...}>Item</MenuItem>
 *   </Menu>
 */
export function Menu({ defaultOpen = false, open: openProp, onOpenChange, className, children }: MenuProps) {
  const [internalOpen, setInternal] = useState(defaultOpen)
  const open = openProp !== undefined ? openProp : internalOpen
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setInternal(v)
    onOpenChange?.(v)
  }
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Ctx.Provider value={{ open, setOpen, rootRef }}>
      <div ref={rootRef} className={cn('relative inline-block', className)}>
        {children}
      </div>
    </Ctx.Provider>
  )
}

function use() {
  const v = useContext(Ctx)
  if (!v) throw new Error('Menu compound components must render inside <Menu>')
  return v
}

export interface MenuTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export function MenuTrigger({ className, onClick, ...rest }: MenuTriggerProps) {
  const { open, setOpen } = use()
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        setOpen(!open)
        onClick?.(e)
      }}
      className={className}
      {...rest}
    />
  )
}

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  onSelect?: () => void
  /** Optional hint/sublabel rendered below the label. */
  hint?: ReactNode
}

export function MenuItem({ onSelect, onClick, hint, className, children, ...rest }: MenuItemProps) {
  const { open, setOpen } = use()
  if (!open) return null
  // Render container once via MenuList: but for simplicity, items render themselves and
  // share the absolute-positioned parent via a sibling list. Use MenuList for that.
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        onClick?.(e)
        onSelect?.()
        setOpen(false)
      }}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm',
        'text-[var(--color-fg-primary)]',
        'hover:bg-[var(--color-bg-elevated)] focus:bg-[var(--color-bg-elevated)]',
        'focus:outline-none',
        className,
      )}
      {...rest}
    >
      <span>{children}</span>
      {hint && <span className="text-xs text-[var(--color-fg-muted)]">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  const { open } = use()
  if (!open) return null
  return <span role="separator" className="my-1 block h-px bg-[var(--color-border-subtle)]" />
}

export interface MenuListProps {
  align?: 'start' | 'end'
  /** Width: 'auto' fits content, 'trigger' matches trigger width. */
  width?: 'auto' | 'trigger'
  className?: string
  children: ReactNode
}

/**
 * Container for the dropdown items. Renders absolutely positioned when open.
 * Must be a sibling of MenuTrigger inside <Menu>.
 */
export function MenuList({ align = 'start', width = 'auto', className, children }: MenuListProps) {
  const { open } = use()
  if (!open) return null
  return (
    <div
      role="menu"
      className={cn(
        'absolute top-full z-50 mt-1 overflow-hidden',
        'min-w-[10rem] rounded-[var(--radius-control)]',
        'bg-[var(--color-bg-overlay)] border border-[var(--color-border-default)]',
        'shadow-[var(--shadow-overlay)] py-1',
        align === 'end' ? 'right-0' : 'left-0',
        width === 'trigger' ? 'w-full' : '',
        className,
      )}
    >
      {children}
    </div>
  )
}
