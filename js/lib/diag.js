import { APP_VERSION } from '../version.js';

const MAX = 160;
const buf = [];
const t0 = performance.now();

export function diagLog(kind, detail = '') {
  buf.push(`${String(Math.round(performance.now() - t0)).padStart(6)}  ${kind}${detail ? ' ' + detail : ''}`);
  if (buf.length > MAX) buf.shift();
}

export function diagReport() {
  const yn = (q) => (window.matchMedia(q).matches ? 'có' : 'không');
  const vv = window.visualViewport;
  const head = [
    `Phiên bản ${APP_VERSION}`,
    navigator.userAgent,
    `màn ${innerWidth}x${innerHeight} (khung nhìn ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : '?'}) · DPR ${devicePixelRatio} · điểm chạm ${navigator.maxTouchPoints}`,
    `mở như ứng dụng: ${yn('(display-mode: standalone)')} · chuột (pointer fine): ${yn('(pointer: fine)')} · hover: ${yn('(hover: hover)')}`,
    `trang ${location.hash || '#/'} · cuộn ${Math.round(scrollY)} · thanh menu ${document.body.classList.contains('nav-hidden') ? 'ẨN' : 'HIỆN'}`,
  ];
  return head.concat('', buf).join('\n');
}

export function bindDiagLog() {
  const vv = window.visualViewport;
  if (vv) {
    let h = Math.round(vv.height);
    vv.addEventListener('resize', () => {
      const n = Math.round(vv.height);
      if (n !== h) { diagLog('khung nhìn', `${h} → ${n}`); h = n; }
    });
  }
  window.addEventListener('hashchange', () => diagLog('đổi trang', location.hash));
}
