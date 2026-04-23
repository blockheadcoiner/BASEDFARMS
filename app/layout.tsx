import type { Metadata } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pressStart2P = Press_Start_2P({
  variable: "--font-press-start",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "BASEDFARMS - Solana Token Launchpad",
  description: "Launch tokens on Solana with audited vesting and real farms. No fake features.",
  openGraph: {
    title: "BASEDFARMS",
    description: "Solana DeFi launchpad",
    url: "https://basedfarms.fun",
    siteName: "BASEDFARMS",
    images: ["https://basedfarms.fun/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    site: "@BASED_FARMS",
    creator: "@BASED_FARMS",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart2P.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
          <WalletProvider>{children}</WalletProvider>
        </body>
    </html>
  );
}
