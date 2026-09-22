import type { Metadata } from 'next';
import './globals.css';
import '../components/resource-packs/packs.css';
import './theme.css';
import './side-picker.css';
import './hud.css';
import './impostor.css';
import './chat.css';
import './game-clock.css';
import './phases.css';
import './settings-menu.css';
import './music-player.css';
import { SettingsSync } from '../components/settings-sync';
/**
 * Ставит тему на <html> до первой отрисовки, чтобы не было вспышки светлого
 * фона. Логика повторяет applyTheme() из hooks/use-theme.ts.
 */
const themeScript = `(function(){try{var c=localStorage.getItem('jinaly-theme');var d=c==='dark'||((c!=='light')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var t=d?'dark':'light';var e=document.documentElement;e.setAttribute('data-theme',t);e.style.colorScheme=t;}catch(_){}})();`;
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
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SettingsSync />
        {children}
      </body>
    </html>
  );
}
