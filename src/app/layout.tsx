import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MSU Naawan Campus Map",
  description: "Interactive campus map of Mindanao State University – Naawan",
  // Opening from the home screen hides the browser bars (full screen on iPhone)
  appleWebApp: { capable: true, title: "Campus Map", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e3a8a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
