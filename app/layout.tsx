import type { Metadata } from 'next';
import './globals.css';
import '../components/resource-packs/packs.css';
export const metadata: Metadata = {
  title: 'Jinaly — ретроспективы в 3D',
  description:
    'Командные ретроспективы в 3D-мире Казахстана и на общей онлайн-доске.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
