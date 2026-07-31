import type { Metadata } from "next";
import RootShell, { baseMetadata } from "../root-shell";

/**
 * English root layout. Also hosts the staff dashboard and the patient
 * manage-booking page, both of which are `noindex` and set their own direction
 * on the content itself.
 */
export const metadata: Metadata = baseMetadata("en");

export default function EnglishLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RootShell language="en">{children}</RootShell>;
}
