export const GOAL_FOCUS_EVENT = "dashboard:plan:focus-goal";

export interface GoalFocusDetail {
  goalId: string;
}

export function dispatchGoalFocus(goalId: string): void {
  if (!goalId || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GoalFocusDetail>(GOAL_FOCUS_EVENT, {
      detail: { goalId }
    })
  );
}
