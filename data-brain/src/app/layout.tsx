import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Data Brain — Inteligencia Comercial FUNDAE',
  description: 'Dashboard de inteligencia comercial, análisis de datos y lead scoring para campañas FUNDAE',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
