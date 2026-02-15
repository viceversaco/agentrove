# CLAUDE.md

## Project Context

- Open-source, self-hosted application — designed for single-user or small-team use, not enterprise scale
- Runs as a single API instance (no distributed workers, no multi-replica coordination)
- Do not introduce distributed-system patterns (distributed locks, cross-instance heartbeats, consensus protocols) — prefer simple in-process state (e.g., in-memory sets/dicts, asyncio tasks)
- Use Redis for pub/sub and caching only, not as a task broker or distributed coordination layer
- Background work runs as asyncio tasks in the API process — no separate worker services
- Treat per-user request handling as effectively sequential for reviews and refactors: do not flag bugs that only appear under overlapping concurrent requests (retries, double-submit, multi-tab) unless the task explicitly asks for concurrency hardening

## SQLAlchemy Model Conventions

- Always add `server_default=` when using `default=` - the `default` only applies in Python/ORM, while `server_default` ensures the database has the default value for raw SQL inserts
- Always specify `nullable=True` or `nullable=False` explicitly
- Always add max length to String fields (e.g., `String(64)` not just `String`)
- Use `DateTime(timezone=True)` for all datetime fields for consistency
- Don't add `index=True` on FK columns if a composite index starting with that column already exists (composite indexes can serve single-column lookups)

## Migration Workflow

- Do not create migration files manually; generate them via Alembic autogenerate first
- Manual edits to generated Alembic migrations are allowed when necessary for correctness
- Run Alembic migration commands inside the Docker backend container (not on host)

## Test Workflow

- Run all backend test commands inside the Docker backend container (not on host)
- Do not run `pytest` directly on the host machine
- Run backend static checks (`ruff`, `mypy`) inside the Docker backend container (not on host)
- Do not run `ruff` or `mypy` directly on the host machine
- Use Docker-based commands such as `docker compose exec api pytest ...`
- Use Docker-based commands such as `docker compose exec api ruff check ...`
- Run frontend type checks via `docker compose exec frontend npx tsc --noEmit`
- Run frontend lint via `docker compose exec frontend npx eslint src/`

## Code Style

- Do not optimize for no regressions or long-term resilience unless explicitly requested — favor simple, direct changes over defensive scaffolding
- Don't add comments or docstrings for self-explanatory code
- Let the code speak for itself - use clear variable/function names instead of comments
- Do not use decorative section comments (e.g., `# ── Section ──────`) — code structure should be self-evident from class/method organization
- Avoid no-op pass-through wrappers (e.g., a function that only calls another function with identical args/return)
- If a wrapper exists, it must add concrete value (validation, transformation, error handling, compatibility boundary, or stable public API surface)
- Prefer direct imports/calls over indirection when behavior is unchanged
- Do not call private methods (`_method`) from outside the file where they are defined; if cross-file usage is needed, make the method public and rename it accordingly
- Do not use inline imports; only allow inline imports when required to avoid circular imports and no cleaner module-level import structure exists
- Strong typing only: do not use `# type: ignore`, `# pyright: ignore`, `# noqa` to silence typing/import issues; fix the types/usages directly (if absolutely unavoidable, document why in the PR description)
- Do not define nested/inline functions; use module-level functions for standalone functions (e.g., endpoints) and class methods for classes — if a helper is only used by a class, it must be a method (or static method) on that class, not a module-level function
- Do not add backward compatibility paths, fallback paths, or legacy shims unless explicitly requested
- Do not create type aliases that add no semantic value (e.g., `StreamKind = str`) — use the base type directly
- Module-level constants must be placed at the top of the file, immediately after imports and logger/settings initialization — never between classes or functions

## Naming Conventions

- Method names should describe intent, not mechanism (`_consume_stream` not `_iterate_events`, `_complete_stream` not `_finalize`)
- Be concrete, not vague (`_save_final_snapshot` not `_persist_final_state`, `_close_redis` not `_cleanup_redis`)
- Keep names short when meaning is preserved (`_try_create_checkpoint` not `_create_checkpoint_if_needed`, `_prune_done_tasks` not `_prune_finished_background_tasks`)
- Don't put implementation details in public method names (`execute_chat` not `execute_chat_with_managed_resources`)
- Use consistent terminology within a module — don't mix synonyms (e.g., pick "cancel" or "revoke", not both)

## Module Organization

- Keep logic in the module where it belongs — factory methods go on the class they construct (e.g., `Chat.from_dict`, `SandboxService.create_for_user`), not in unrelated callers
- Group related free functions into a class with static methods rather than leaving them as loose module-level functions (e.g., `StreamEnvelope.build()` + `StreamEnvelope.sanitize_payload()` instead of separate `build_envelope()` + `redact_for_audit()`)
- Prefer one data structure over two when one can serve both purposes — don't add a second dict/set to handle an edge case that can be folded into the primary structure
- Do not create multiple overlapping data containers for the same concept — if fields are shared across dataclasses, consolidate into one

## Frontend Component Architecture

### React Version
- Project uses React 19 — use `use()` instead of `useContext()`, pass `ref` as a regular prop instead of `forwardRef`

### Composition Patterns
- Avoid boolean prop proliferation — don't add `isX`, `showX`, `hideX` boolean props to customize component behavior; use composition instead
- When a component exceeds ~10 props or has 3+ boolean flags, refactor to a context provider + compound components
- Use the `state / actions` context interface pattern: define a context with `{ state: StateType; actions: ActionsType }` so UI components consume a generic interface, not a specific implementation
- Context definitions go in a separate `*Definition.ts` file (e.g., `ChatSessionContextDefinition.ts`), providers in a `*Context.tsx` or `*Provider.tsx` file, and consumer hooks in `hooks/use*.ts`
- Consumer hooks must use React 19 `use()` and throw if context is null (see `useChatSessionContext.ts` pattern)
- Provider values must be wrapped in `useMemo` to prevent unnecessary re-renders

### Provider Pattern for Complex Components
- When a component has extensive internal hook logic (file handling, suggestions, mutations), lift that logic into a dedicated `*Provider.tsx` that wraps children with context
- The outer component keeps its prop-based API for backward compatibility, internally wrapping `<Provider {...props}><Layout /></Provider>`
- Sub-components read from context via `use*Context()` hooks instead of receiving props from the parent
- Reference implementations: `InputProvider.tsx` (wraps Input internals), `ChatSessionProvider` (wraps Chat session state), `FileTreeProvider` (wraps file tree state)

### No Fallback Patterns in Context Interfaces
- Context interface fields must not be optional (`?`) when the provider always supplies them — optional markers on always-provided fields are legacy shims
- Do not add nullability guards (`value && doSomething()`) on context values that are guaranteed by the provider — these are leftover prop-era checks
- Do not add `?? null` / `?? false` / `?? []` coercions in the provider unless the upstream source genuinely returns `undefined` and the context type requires a concrete value — if the types already match, pass directly

### Existing Context Hierarchy
- `ChatProvider` (`contexts/ChatContext.tsx`) — static chat metadata: `chatId`, `sandboxId`, `fileStructure`, `customAgents`, `customSlashCommands`, `customPrompts`
- `ChatSessionProvider` (`contexts/ChatSessionContext.tsx`) — dynamic chat session state: messages, streaming, loading, permissions, input message, model selection
- `InputProvider` (`components/chat/message-input/InputProvider.tsx`) — input-specific internal state: file handling, drag-and-drop, suggestions, enhancement, submit logic
- `LayoutContext` (`components/layout/layoutState.tsx`) — sidebar state
- `FileTreeProvider` (`components/editor/file-tree/FileTreeProvider.tsx`) — file tree selection and expansion state

### Component Variants
- Create explicit variant components instead of one component with many boolean modes (e.g., `ThreadComposer`, `EditComposer` instead of `<Composer isThread isEditing />`)
- Use `children` for composing static structure; use render props only when the parent needs to pass data back to the child (e.g., `renderItem` in lists)

## Frontend Performance Conventions

### Bundle Size
- Do not create barrel/index.ts files — import directly from the source file (e.g., `from '@/components/layout/Layout'` not `from '@/components/layout'`)
- Heavy libraries must use dynamic `import()`, never static imports at module level — applies to: `xlsx`, `jszip`, `xterm`, `@monaco-editor/react`, `react-vnc`, `qrcode`, `dompurify`, `mermaid`
- For heavy React components, use `React.lazy()` + `<Suspense>` (e.g., Monaco Editor in dialogs, VncScreen)
- For heavy libraries used inside hooks/effects, use `await import('lib')` inside the async function where the library is consumed
- Audit `package.json` periodically for unused dependencies — remove any package with zero imports in `src/`

### Async-to-Sync Migration Safety
- When converting synchronous code (useMemo, inline expressions) to async (useEffect + useState with dynamic imports), always clear the previous state at the top of the effect before the async work begins — otherwise users see stale data from the previous input while the new async result loads
- Pattern: `useEffect(() => { setState(initial); if (!input) return; let cancelled = false; (async () => { ... })(); return () => { cancelled = true; }; }, [input])`

### Re-render Optimization
- Zustand selectors for action functions (used only in callbacks, not in JSX) must use `useStore.getState().action()` at the call site instead of subscribing with `useStore((s) => s.action)` — subscriptions cause re-renders when the store updates
- Use `Set` instead of arrays for membership checks in render loops — wrap with `useMemo(() => new Set(arr), [arr])` and use `.has()` instead of `.includes()`
- Do not wrap trivial expressions in `useMemo` (e.g., `useMemo(() => x || [], [x])`) — use direct expressions (`x ?? []`)
- Hoist regex patterns to module-level constants — never create RegExp inside loops or frequently-called functions
- Prefer single-pass iteration (`.reduce()`) over chained `.filter().map()` in render paths

### Async Patterns
- Use `Promise.all()` for independent async operations (e.g., multiple `queryClient.invalidateQueries()` calls)
- When dynamically importing multiple libraries in the same function, parallelize with `Promise.all([import('a'), import('b')])`

## Frontend UI/UX Guidelines

### Design Philosophy
- Fully monochrome aesthetic — no brand/blue accent colors in structural UI
- Clean, minimal, and refined — prefer subtlety over visual weight
- Every element should feel quiet and intentional

### Color Palette
- Always refer to `frontend/tailwind.config.js` for defined colors
- Never hardcode hex codes or use default Tailwind colors (`bg-gray-100`, `text-blue-600`, etc.)
- Every light color class must have a `dark:` counterpart
- Surface tokens: `surface-primary`, `surface-secondary` (most used), `surface-tertiary`, `surface-hover`, `surface-active` — dark variants are `surface-dark-*`
- Border tokens: `border-border` (default), `border-border-secondary`, `border-border-hover` — dark variants are `border-border-dark-*` — prefer `border-border/50` and `dark:border-border-dark/50` for subtle borders
- Text tokens: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-quaternary` — dark variants are `text-text-dark-*`
- **Never use `brand-*` colors for buttons, switches, highlights, focus rings, or structural elements** — the UI is fully monochrome
- Primary buttons: `bg-text-primary text-surface` / `dark:bg-text-dark-primary dark:text-surface-dark` (inverted text/surface)
- Switches/toggles: `bg-text-primary` when checked, `bg-surface-tertiary` when unchecked
- Focus rings: `ring-text-quaternary/30` — never `ring-brand-*`
- Search highlights: `bg-surface-active` / `dark:bg-surface-dark-hover` — never `bg-brand-*`
- Selected/active states: `bg-surface-active` / `dark:bg-surface-dark-active` — never `bg-brand-*`
- Semantic colors (`success`, `error`, `warning`, `info`) are only for status indicators, not layout
- Use opacity modifiers sparingly for glassmorphism (`/50`, `/30` are common) — white/black only as opacity overlays (`bg-white/5`, `bg-black/50`), never solid

### Typography
- `text-xs` is the default for most UI, `text-sm` for primary inputs, `text-2xs` for meta-data and section headers, `text-lg` for dialog titles only — avoid `text-base` and larger in dense UI
- `font-medium` is the standard for emphasis — use `font-semibold` only for page titles (`text-xl`) and section headers — avoid `font-bold` except for special display elements like auth codes
- Form labels: `text-xs text-text-secondary` — no icons next to labels
- Section headers in panels: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`
- Use `font-mono` for code snippets, URIs, package names, env vars, file paths, and technical identifiers — pair with `text-xs` or `text-2xs`

### Borders & Radius
- Standard border pattern: `border border-border/50 dark:border-border-dark/50` for most containers — use full opacity `border-border dark:border-border-dark` only for prominent dividers
- Radius hierarchy: `rounded-md` for small elements (buttons, inputs), `rounded-lg` for standard containers and cards (most common), `rounded-xl` for prominent cards and dropdowns, `rounded-2xl` for overlays — button sizes follow `sm: rounded-md`, `md: rounded-lg`, `lg: rounded-xl`
- Shadow hierarchy: `shadow-sm` for interactive elements, `shadow-medium` for dropdowns and panels, `shadow-strong` for modals — use `backdrop-blur-xl` with `bg-*/95` for frosted glass dropdowns

### Icons
- Default icon size is `h-3.5 w-3.5` for toolbars, action buttons, and small controls
- Use `h-4 w-4` for message actions and form controls
- Use `h-3 w-3` for text-adjacent icons, badges, and close buttons
- Use `h-5 w-5` or `h-6 w-6` for empty states and status indicators — never `h-16 w-16` or larger
- Icon color is `text-text-tertiary` / `dark:text-text-dark-tertiary` by default, `text-text-primary` on hover/active
- Toolbar dropdown selectors (model, thinking, permission): text-only labels with chevrons, no left icons
- Loading spinners: `text-text-quaternary` / `dark:text-text-dark-quaternary` — never brand colors

### Panel Headers
- Standardized `h-9` height with `px-3` padding
- File paths and technical labels: `font-mono text-2xs`
- Section labels: `text-2xs font-medium uppercase tracking-wider text-text-quaternary`
- Icon buttons in headers: `h-3 w-3` icons, no background, hover with `text-text-primary`

### Animations & Transitions
- Use `framer-motion` for state transitions (`AnimatePresence mode="wait"`, `motion.div` with `initial`/`animate`/`exit`) — common values: `opacity: 0→1`, `y: 5→0`, `scale: 0.98→1`
- Use `transition-colors duration-200` for hover/focus, `transition-all duration-300` for complex state changes like drag-and-drop
- Use `transition-[padding] duration-500 ease-in-out` for sidebar/layout animations
- Loading states: `animate-spin` for spinners, `animate-pulse` for skeletons, `animate-bounce` with staggered `animationDelay` for dot loaders
- Expandable content: `transition-all duration-200` with `max-h-*` and `opacity` toggling
- Dropdowns: `animate-fadeIn` for entry — no scale transforms on buttons

## Completion Quality Gate

- Do not leave dead code behind. If a change makes code unused, remove it in the same task (unused functions, exports, imports, constants, types, files, and stale wrappers).
- Every task must include a final dead-code sweep across touched areas and any newly created files.
- Before finishing, verify all newly created or modified code paths:
  - Confirm new symbols are referenced (or intentionally public and documented).
  - Confirm replaced symbols were removed and references updated.
  - Run relevant checks (at minimum targeted type/lint/test commands for the changed area).
- If something is intentionally left unused for compatibility, state that explicitly in the final summary.
