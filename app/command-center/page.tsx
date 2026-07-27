import type { Metadata } from "next";
import CommandCenter from "./CommandCenter";
import "./command-center.css";

export const metadata: Metadata = {
  title: "Clinic Command Center",
  description: "A live operations demo for Dr. Ashraf Metwally's clinic.",
};

export default function CommandCenterPage() {
  return <CommandCenter />;
}
