import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Inter } from "next/font/google";
import { ToastProvider } from "./ToastProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Investiga — OSINT",
  description: "Ferramenta de investigação OSINT com integrações e dossiê.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} ${inter.className} antialiased`}>
        <header className="bg-white border-b">
          <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="font-semibold">Investiga</div>
            <ul className="flex items-center gap-4 text-sm">
              <li><Link className="text-blue-700 hover:underline" href="/">Home</Link></li>
              <li><Link className="text-blue-700 hover:underline" href="/osint">OSINT</Link></li>
              <li><Link className="text-blue-700 hover:underline" href="/status">Status</Link></li>
            </ul>
          </nav>
        </header>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
