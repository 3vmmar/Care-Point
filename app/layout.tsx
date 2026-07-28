import type { Metadata } from "next";
import { Cormorant_Garamond, IBM_Plex_Sans_Arabic, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600"],
});

// Set SITE_URL to the clinic's real domain at build time. The preview host is
// only a fallback so absolute OpenGraph URLs still resolve before launch.
const SITE_URL =
  process.env.SITE_URL ?? "https://dr-ashraf-future-clinic.nimble-pig-6675.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Dr. Ashraf Metwally | The Future of Aesthetic Care",
    template: "%s | Dr. Ashraf Metwally",
  },
  description:
    "A future-facing aesthetic care experience with intelligent guidance and live appointment booking.",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
  },
  openGraph: {
    title: "Dr. Ashraf Metwally — The Future of Aesthetic Care",
    description: "Meet NOOR, explore treatments, and reserve a visit in real time.",
    images: [{ url: "/og.jpg", width: 1200, height: 630 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `lang`/`dir` are updated on the client when the visitor switches language.
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body
        className={`${manrope.variable} ${cormorant.variable} ${arabic.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
