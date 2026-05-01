/**
 * Next.js cache tag helper for plan-week allocation inputs. Lives in its own
 * module so Google Calendar busy caching can invalidate without importing the
 * full allocation context graph (circular dependency otherwise).
 */

import { revalidateTag } from "next/cache";

export function userAllocationCacheTag(userId: string): string {
  return `user-alloc-context-${userId}`;
}

export function invalidateUserAllocationCache(userId: string): void {
  revalidateTag(userAllocationCacheTag(userId));
}
