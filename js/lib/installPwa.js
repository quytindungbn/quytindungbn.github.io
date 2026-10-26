import { currentInstallEnv } from './installEnv.js';

let deferredPrompt = null;
const installableCallbacks = [];

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installableCallbacks.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
});

export function onInstallable(fn) {
  if (deferredPrompt) fn();
  else installableCallbacks.push(fn);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return currentInstallEnv().os === 'ios';
}

export async function looksInstalled() {
  try {
    if (typeof navigator.getInstalledRelatedApps === 'function') {
      const apps = await navigator.getInstalledRelatedApps();
      return Array.isArray(apps) && apps.length > 0;
    }
  } catch {  }
  return false;
}

export function hasNativePrompt() {
  return !!deferredPrompt;
}

export async function promptInstall() {
  if (isStandalone()) return 'already-installed';

  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice.outcome;
  }
  if (currentInstallEnv().inApp) return 'in-app';
  if (isIOS()) return 'ios-manual';
  return 'unsupported';
}
