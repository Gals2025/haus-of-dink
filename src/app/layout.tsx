import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Haus of Dink | Made for the court",
    template: "%s | Haus of Dink",
  },
  description:
    "Pickleball paddles and accessories. The foundation for your next great game.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
