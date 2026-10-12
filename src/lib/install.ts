// "Install ScreenLab" support: registers the service worker and keeps the
// browser's install prompt so a menu item can show it later.
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
/** iPhone/iPad Safari has no install prompt: people use Share → Add to Home Screen. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

/** 'prompt': the browser can install now; 'ios': show Add to Home Screen steps; null: already installed or not offered. */
export function useInstallOption(): 'prompt' | 'ios' | null {
  const ready = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => deferred !== null);
  if (isStandalone()) return null;
  if (ready) return 'prompt';
  return isIos() ? 'ios' : null;
}
