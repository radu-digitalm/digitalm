import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const fontVariables = `${spaceGrotesk.variable} ${inter.variable} ${ibmPlexMono.variable}`;
