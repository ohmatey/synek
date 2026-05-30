import { Menu, MenuItem, MenuList, MenuTrigger } from '@strata/ui'

export function RowMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Timeline actions"
        title="Actions"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-transparent text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
      >
        ⋯
      </MenuTrigger>
      <MenuList align="end">
        <MenuItem onSelect={onRename}>Rename</MenuItem>
        <MenuItem
          onSelect={onDelete}
          className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft-bg)] focus:bg-[var(--color-danger-soft-bg)]"
        >
          Delete
        </MenuItem>
      </MenuList>
    </Menu>
  )
}
