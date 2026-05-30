// @strata/ui — barrel exports.

// ─── Theme ────────────────────────────────────────────────────
export { ThemeProvider, useThemeContext } from './theme/ThemeProvider'
export { useTheme } from './theme/useTheme'
export { ThemeToggle } from './theme/ThemeToggle'
export type { ThemeToggleProps } from './theme/ThemeToggle'
export { themeInitScript, THEME_COOKIE } from './theme/theme-init-script'
export type { Theme, ResolvedTheme } from './theme/types'

// ─── Primitives ───────────────────────────────────────────────
export { Button } from './primitives/Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './primitives/Button'
export { IconButton } from './primitives/IconButton'
export type {
  IconButtonProps,
  IconButtonVariant,
  IconButtonSize,
} from './primitives/IconButton'
export { Card } from './primitives/Card'
export type { CardProps } from './primitives/Card'
export { Panel } from './primitives/Panel'
export type { PanelProps } from './primitives/Panel'
export { Input } from './primitives/Input'
export type { InputProps } from './primitives/Input'
export { Textarea } from './primitives/Textarea'
export type { TextareaProps } from './primitives/Textarea'
export { Dialog, DialogTitle, DialogBody, DialogFooter } from './primitives/Dialog'
export type { DialogProps } from './primitives/Dialog'
export { Menu, MenuTrigger, MenuItem, MenuList, MenuSeparator } from './primitives/Menu'
export type {
  MenuProps,
  MenuTriggerProps,
  MenuItemProps,
  MenuListProps,
} from './primitives/Menu'
export { Badge } from './primitives/Badge'
export type { BadgeProps, BadgeVariant } from './primitives/Badge'
export { Tooltip } from './primitives/Tooltip'
export type { TooltipProps } from './primitives/Tooltip'
export { Spinner } from './primitives/Spinner'
export type { SpinnerProps } from './primitives/Spinner'
export { Divider } from './primitives/Divider'
export type { DividerProps } from './primitives/Divider'
export { ClientOnly } from './primitives/ClientOnly'

// ─── Utils ────────────────────────────────────────────────────
export { cn } from './utils/cn'
