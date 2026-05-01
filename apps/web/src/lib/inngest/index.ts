import { inngest } from "./client";
import { refreshGoogleBusySnapshot } from "./google-busy-refresh";
import { regenerateSnapshot } from "./regenerate";

export const inngestFunctions = [regenerateSnapshot, refreshGoogleBusySnapshot];
export { inngest };
