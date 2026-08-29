import type { Metadata } from "next";
import { Geist_Mono, Inter_Tight } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/components/providers";
import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "OTC Desk Vaults",
  description:
    "Read-only dashboard for OTC Desks on Solana. Inspect $OTC, NFT desks, vault stock, and derived yield. Cannot move funds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${interTight.className} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var t = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = t;
  document.documentElement.classList.toggle('dark', t === 'dark');
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.classList.add('dark');
}
`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
