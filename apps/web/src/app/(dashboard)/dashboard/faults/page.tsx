import { FaultsDashboard } from "@/components/faults/faults-dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fault Reports",
};

export default function FaultsPage() {
  return <FaultsDashboard />;
}
