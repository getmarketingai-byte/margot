# Dashboard UI performance validation

Use this checklist after changes to optimistic updates, revalidation, or allocator caching.

## Automated

From `apps/web`:

```bash
pnpm lint
pnpm typecheck
```

## Manual (desktop)

1. **Goal list (Perfect Week)**  
   - Add, edit title, toggle constraints, reorder, delete.  
   - Expect: UI updates immediately; capacity/pace numbers catch up within ~1s idle (soft refresh).  
   - DevTools console: `[ui-perf]` lines for perceived vs server ACK (optional).

2. **Planning → Framework toggles**  
   - Enable/disable scheduler rows and overlay checkboxes.  
   - Expect: cards move between Active/Available without full-page flash.

3. **Calendar drag + reset**  
   - Drag a proposed block; use reset on a dragged bar.  
   - Expect: no hard reload; debounced reconcile updates metrics/calendar rail.

4. **Navigation**  
   - Click each primary nav tab repeatedly.  
   - Expect: second visits feel faster (`DashboardRoutePrefetch` + cached allocation inputs when data unchanged).

5. **Settings / calendars**  
   - Change timezone or toggle a calendar source.  
   - Expect: plan + planning pages reflect changes after navigation or soft reload without triple `revalidatePath` churn.
