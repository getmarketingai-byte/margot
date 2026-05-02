import { inngest } from "./client";
import { fullScheduleRefresh } from "./full-schedule-refresh";
import { refreshGoogleBusySnapshot } from "./google-busy-refresh";
import { regenerateSnapshot } from "./regenerate";

export const inngestFunctions = [
  regenerateSnapshot,
  refreshGoogleBusySnapshot,
  fullScheduleRefresh
];
export { inngest };
