import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "margot",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
