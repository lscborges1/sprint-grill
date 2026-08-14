import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeSelector } from "@/components/theme-selector";
import { THEME_INITIALIZATION_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sprint Griller",
  description:
    "Investigação antes da cerimônia e grilling coletivo com decisões documentadas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      data-theme="system"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INITIALIZATION_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeSelector />
        {children}
      </body>
    </html>
  );
}
