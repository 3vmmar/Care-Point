import type { Metadata } from "next";
import RootShell, { baseMetadata } from "../root-shell";

/** Arabic root layout: `lang="ar" dir="rtl"` in the server-rendered HTML. */
export const metadata: Metadata = baseMetadata("ar");

export default function ArabicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RootShell language="ar">{children}</RootShell>;
}
