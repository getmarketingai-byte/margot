import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "calendar-automations",
  eventKey: process.env.INNGEST_EVENT_KEY ?? "dev"
});

export type Events = {
  "user/regenerate.requested": {
    data: { userId: string; reason: "cron" | "user" | "settings-change" };
  };
  "user/google-busy.refresh-requested": {
    data: { userId: string; reason: "cron" };
  };
  "user/snapshot.completed": {
    data: { userId: string };
  };
};
