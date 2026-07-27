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

export const metadata: Metadata = {
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
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${manrope.variable} ${cormorant.variable} ${arabic.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
