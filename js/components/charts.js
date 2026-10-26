import { formatVND, formatCompact, formatNumber } from '../utils.js';

const VB_W = 400;

export function formatTyDong(n) {
  return (Math.round((n || 0) / 1e7) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export function formatTrieuDong(n) {
  return `${formatNumber(Math.round((Number(n) || 0) / 1e6))}tr`;
}

export function barChartSvg({ items, aspect = 2.1 }) {
  const vbH = Math.round(VB_W / aspect);
  const chartH = vbH - 34;
  const max = Math.max(1, ...items.map((it) => it.value));
  const barW = VB_W / items.length;
  const gap = barW * 0.14;
  const barsHtml = items.map((it, i) => {

    const h = Math.max(3, (it.value / max) * chartH * 0.85);
    const x = i * barW + gap / 2;
    const w = barW - gap;
    const y = chartH - h;
    const idAttr = it.id != null ? ` data-id="${it.id}" style="cursor:pointer"` : '';
    return `
      <g${idAttr}>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${it.color}"></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${Math.max(13, y - 8).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="${it.value > 0 ? it.color : 'var(--text-faint)'}">${formatCompact(it.value)}</text>
        <title>${it.label}: ${formatVND(it.value)}</title>
      </g>`;
  }).join('');
  const labels = items.map((it) => `<div${it.id != null ? ` data-id="${it.id}"` : ''} style="flex:1;text-align:center;font-size:11px;color:var(--text-muted)${it.id != null ? ';cursor:pointer' : ''}">${it.shortLabel ?? it.label}</div>`).join('');
  return `
    <div style="max-width:460px">
      <svg viewBox="0 0 ${VB_W} ${chartH}" style="width:100%;height:auto;display:block;overflow:visible">
        <line x1="0" y1="${chartH - 0.5}" x2="${VB_W}" y2="${chartH - 0.5}" stroke="var(--border)" stroke-width="1"></line>
        ${barsHtml}
      </svg>
      <div style="display:flex;margin-top:8px">${labels}</div>
    </div>`;
}

export function compositionDonutHtml({ items, total, totalCount = 0, metric = 'balance', countComplete = true, tab = 'purpose' }) {
  if (!(total > 0)) {
    return '<p class="text-sm text-muted" style="padding:12px 0">Chưa có dư nợ để tính tỷ trọng.</p>';
  }
  const byCount = metric === 'count' && countComplete && totalCount > 0;
  const denominator = byCount ? totalCount : total;
  const measure = (item) => byCount ? item.count : item.value;
  const centerX = 145;
  const centerY = 120;
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const percent = (value, base) => {
    const p = base > 0 ? value / base * 100 : 0;
    return p > 0 && p < 0.05 ? '<0,1%' : `${p.toFixed(1).replace('.', ',')}%`;
  };

  const labelWidth = (label) => [...label].reduce((width, char) =>
    width + (char === ',' ? 3 : char === '%' ? 8 : char === '<' ? 6 : 5.6), 0);
  const outsideLabels = [];
  const arcs = items.map((item) => {
    const length = Math.max(0, measure(item) / denominator * circumference);
    const share = measure(item) / denominator;
    const angle = -Math.PI / 2 + (offset + length / 2) / radius;
    const label = percent(measure(item), denominator);
    const arc = `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${item.color}" stroke-width="34"
      stroke-dasharray="${length.toFixed(4)} ${circumference.toFixed(4)}" stroke-dashoffset="${(-offset).toFixed(4)}"
      transform="rotate(-90 ${centerX} ${centerY})" data-composition-category="${item.code}" role="button" tabindex="0"
      aria-label="Xem danh sách ${item.label}" style="cursor:pointer"><title>${item.label}: ${byCount ? `${formatNumber(item.count)} món vay` : formatVND(item.value)} (${label})</title></circle>`;
    if (share > 0 && length >= labelWidth(label) + 4) {
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      outsideLabels.push({ inside: true, html: `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="800" fill="#fff" style="pointer-events:none">${label}</text>` });
    } else if (share > 0) {
      outsideLabels.push({ inside: false, right: Math.cos(angle) >= 0,
        x: centerX + 100 * Math.cos(angle), y: centerY + 100 * Math.sin(angle), label });
    }
    offset += length;
    return arc;
  }).join('');
  for (const right of [false, true]) {
    const side = outsideLabels.filter((item) => !item.inside && item.right === right).sort((a, b) => a.y - b.y);
    side.forEach((item, i) => {
      const minY = i ? side[i - 1].labelY + 16 : 12;
      const maxY = 228 - (side.length - i - 1) * 16;
      item.labelY = Math.max(minY, Math.min(maxY, item.y));
    });
  }
  const shareLabels = outsideLabels.map((item) => {
    if (item.inside) return item.html;
    const lineX = item.right ? 247 : 43;
    const textX = item.right ? 252 : 38;
    return `<polyline points="${item.x.toFixed(1)},${item.y.toFixed(1)} ${lineX},${item.labelY.toFixed(1)}" fill="none" stroke="var(--text-muted)" stroke-width="1" />
      <text x="${textX}" y="${item.labelY.toFixed(1)}" text-anchor="${item.right ? 'start' : 'end'}" dominant-baseline="middle" font-size="10" font-weight="800" fill="#000">${item.label}</text>`;
  }).join('');
  const legendItem = (item) => {
    const countText = countComplete || item.countKnown !== false
      ? `<strong>${formatNumber(item.count)}</strong>`
      : 'Chưa rõ số món vay';
    const share = percent(measure(item), denominator);
    return `
    <button type="button" class="composition-legend-item" data-composition-category="${item.code}" aria-label="Xem danh sách ${item.label}">
      <span class="composition-legend-dot" style="background:${item.color}" aria-hidden="true"></span>
      <span class="composition-legend-title"><span class="composition-legend-name">${item.label}</span><strong class="composition-legend-share">${share}</strong></span>
      <span class="composition-legend-value">Dư nợ: <strong>${formatVND(item.value)}</strong><br>Số món vay: ${countText}</span>
    </button>`;
  };
  const legend = tab === 'collateral' ? (() => {
    const secured = items.filter((item) => item.code !== 'KCDB');
    const unsecured = items.find((item) => item.code === 'KCDB');
    const securedTotal = secured.reduce((sum, item) => sum + measure(item), 0);
    const securedCount = secured.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    return `<div class="composition-collateral-grid">
      <section class="composition-collateral-group" aria-label="Có tài sản bảo đảm">
        <div class="composition-collateral-heading"><span>Có tài sản bảo đảm (số món: ${formatNumber(securedCount)})</span><strong>${percent(securedTotal, denominator)}</strong></div>
        ${secured.length ? secured.map(legendItem).join('') : '<p class="composition-collateral-empty">Chưa có món vay</p>'}
      </section>
      <section class="composition-collateral-group" aria-label="Không có tài sản bảo đảm">
        <div class="composition-collateral-heading"><span>Không có tài sản bảo đảm</span><strong>${percent(measure(unsecured || { value: 0, count: 0 }), denominator)}</strong></div>
        ${unsecured ? legendItem(unsecured) : '<p class="composition-collateral-empty">Chưa có món vay</p>'}
      </section>
    </div>`;
  })() : items.map(legendItem).join('');
  return `
    <div class="composition-content">
      <svg class="composition-donut-svg" viewBox="0 0 290 240" role="img" aria-label="Biểu đồ tỷ trọng ${byCount ? 'số món vay' : 'dư nợ'}">
        <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="var(--surface-alt)" stroke-width="34"></circle>
        ${arcs}
        ${shareLabels}
        <text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" fill="var(--text)">${byCount ? 'Số món vay' : 'Dư nợ'}</text>
      </svg>
      <div class="composition-legend${tab === 'collateral' ? ' composition-legend--collateral' : ''}">${legend}</div>
    </div>`;
}

export function monthlyComboChartSvg({ months, aspect = 1.5, balanceColor = 'var(--color-primary)', badDebtColor = 'var(--warning)', selectedYm = null }) {
  if (!months.length) {
    return `<div class="text-sm text-muted" style="text-align:center;padding:24px 0">Chưa có số liệu.</div>`;
  }
  const vbH = Math.round(VB_W / aspect);
  const padTop = 16;
  const padBottom = 20;
  const chartH = vbH - padTop - padBottom;
  const baseY = padTop + chartH;

  const n = months.length;

  const SLOT_PX = 54;
  const scroll = n > 7;
  const chartW = scroll ? n * SLOT_PX : VB_W;

  const slotW = scroll ? SLOT_PX : chartW / Math.max(n, 8);
  const slotGap = slotW * 0.12;
  const innerW = slotW - slotGap;
  const balW = innerW * 0.6;

  const balMax = Math.max(1, ...months.map((m) => m.balance));
  const liveIdx = months[n - 1].live ? n - 1 : -1;

  const bars = months.map((m, i) => {
    const slotX = i * slotW + slotGap / 2;
    const isLive = i === liveIdx;
    const isSelected = selectedYm != null && m.yearMonth === selectedYm;
    const dash = isLive ? `stroke-dasharray="3 2"` : '';

    const balH = Math.max(3, (m.balance / balMax) * chartH);
    const balY = baseY - balH;

    const BOOST = 7.5;
    const badRatio = m.balance > 0 ? Math.min(1, m.badDebt / m.balance) : 0;
    const badH = badRatio > 0 ? Math.min(balH * 0.7, Math.max(24, badRatio * balH * BOOST)) : 0;
    const badY = baseY - badH;

    const liveOpacity = isLive ? 0.85 : 1;

    return `
      <g data-month="${m.yearMonth}" style="cursor:pointer">
        ${isSelected ? `<rect x="${(slotX - slotGap / 2).toFixed(1)}" y="${(padTop - 6).toFixed(1)}" width="${slotW.toFixed(1)}" height="${(chartH + 12).toFixed(1)}" rx="6" fill="${balanceColor}" fill-opacity="0.08"></rect>` : ''}
        <rect x="${slotX.toFixed(1)}" y="${balY.toFixed(1)}" width="${balW.toFixed(1)}" height="${balH.toFixed(1)}" rx="4" fill="${balanceColor}" fill-opacity="${liveOpacity}" ${isLive ? `stroke="${balanceColor}" stroke-width="1" ${dash}` : ''}><title>${m.label}: Dư nợ ${formatVND(m.balance)}</title></rect>
        ${badH > 0 ? `<rect x="${slotX.toFixed(1)}" y="${badY.toFixed(1)}" width="${balW.toFixed(1)}" height="${badH.toFixed(1)}" rx="4" fill="${badDebtColor}" fill-opacity="${liveOpacity}"><title>${m.label}: Nợ xấu ${formatVND(m.badDebt)} (${m.badDebtRatio.toFixed(1).replace('.', ',')}%)</title></rect>
        <text x="${(slotX + balW / 2).toFixed(1)}" y="${(badY + 9).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff">${formatTyDong(m.badDebt)}</text>
        <text x="${(slotX + balW / 2).toFixed(1)}" y="${(badY + 17).toFixed(1)}" text-anchor="middle" font-size="6.5" font-weight="700" fill="#fff">(${m.badDebtRatio.toFixed(1).replace('.', ',')}%)</text>` : ''}
        <text x="${(slotX + balW / 2).toFixed(1)}" y="${(balY - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${balanceColor}">${formatTyDong(m.balance)}</text>

        <text x="${(slotX + innerW / 2).toFixed(1)}" y="${vbH - 5}" text-anchor="middle" font-size="10" font-weight="${isLive || isSelected ? 700 : 400}" fill="${isLive || isSelected ? balanceColor : 'var(--text-faint)'}">${m.label}</text>
      </g>`;
  }).join('');

  const svgHtml = `
    <svg viewBox="0 0 ${chartW} ${vbH}" style="${scroll ? `width:${chartW}px;flex-shrink:0` : 'width:100%;max-width:460px'};height:auto;display:block;overflow:visible">
      <line x1="0" y1="${(baseY - 0.5).toFixed(1)}" x2="${chartW}" y2="${(baseY - 0.5).toFixed(1)}" stroke="var(--border)" stroke-width="1"></line>
      ${bars}
    </svg>`;

  return `
    <div style="font-size:10.5px;color:var(--text-muted);margin-bottom:4px">Đơn vị trên biểu đồ: tỷ đồng${scroll ? ' — vuốt sang trái để xem thêm tháng cũ hơn' : ''}</div>
    <div class="flex items-center" style="gap:14px;margin-bottom:6px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:${balanceColor};display:inline-block"></span>Dư nợ</span>
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:${badDebtColor};display:inline-block"></span>Nợ xấu</span>
    </div>
    ${scroll ? `<div class="trend-scroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch">${svgHtml}</div>` : svgHtml}`;
}

export const BALANCE_TREND_COLOR = '#087d6a';
export function monthlyTrendLineChartSvg({ months, selectedYm = null, balanceColor = BALANCE_TREND_COLOR, badDebtColor = '#c04343' }) {
  if (!months.length) return '<div class="text-sm text-muted" style="text-align:center;padding:24px 0">Chưa có số liệu.</div>';
  const renderSvg = (mobile) => {
    const viewport = mobile ? 330 : 1080;
    const visible = mobile ? 6 : 12;
    const left = mobile ? 25 : 45;

    const slots = mobile ? visible : Math.min(visible, Math.max(months.length, 2));
    const step = (viewport - left - 32) / (slots - 1);
    const width = Math.max(viewport, left + step * (months.length - 1) + 32);
    const top = 30, bottom = mobile ? 185 : 220, height = mobile ? 220 : 260;
    const x = (i) => left + i * step;
    const balances = months.map((m) => Math.max(0, Number(m.balance) || 0));
    const badDebts = months.map((m) => Math.max(0, Number(m.badDebt) || 0));

    const balanceBottom = mobile ? 99 : 113;
    const badTop = mobile ? 125 : 147;

    const scaledY = (values, laneTop, laneBottom) => {
      const min = Math.min(...values), max = Math.max(...values);
      const padding = Math.max((max - min) * .25, max * .02, 1);
      const floor = Math.max(0, min - padding), span = max + padding - floor;
      return (value) => laneBottom - (value - floor) / span * (laneBottom - laneTop);
    };
    const balanceY = scaledY(balances, top, balanceBottom);

    const badCeiling = Math.max(1, ...badDebts) * 1.12;
    const badY = (value) => bottom - value / badCeiling * (bottom - badTop);
    const grid = [balanceBottom, (balanceBottom + badTop) / 2, bottom]
      .map((yy) => `<line x1="${left}" y1="${yy}" x2="${width - 20}" y2="${yy}" stroke="#e2e8f0"/>`).join('');
    const line = (values, pointY, color, dashed) => `<polyline fill="none" stroke="${color}" stroke-width="${mobile ? 2 : 2.7}" stroke-linecap="round" stroke-linejoin="round" ${dashed ? 'stroke-dasharray="5 3"' : ''} points="${values.map((v, i) => `${x(i)},${pointY(v)}`).join(' ')}"/>`;
    const dots = months.map((m, i) => {
      const isLive = m.live;
      const label = `${m.yearMonth.slice(5, 7)}/${m.yearMonth.slice(2, 4)}`;
      const balancePointY = balanceY(balances[i]), badPointY = badY(badDebts[i]);
      return `<g data-month="${m.yearMonth}" role="button" tabindex="0" style="cursor:pointer" aria-label="${label}: Dư nợ ${formatVND(balances[i])}, nợ xấu ${formatVND(badDebts[i])}">
        ${m.yearMonth === selectedYm ? `<rect x="${x(i) - step * .45}" y="${top - 15}" width="${step * .9}" height="${bottom - top + 38}" rx="5" fill="${balanceColor}" fill-opacity=".07"/>` : ''}
        <circle cx="${x(i)}" cy="${balancePointY}" r="${mobile ? 4 : 5}" fill="${balanceColor}" stroke="white" stroke-width="1.5" ${isLive ? 'stroke-dasharray="2 1"' : ''}/>
        <circle cx="${x(i)}" cy="${badPointY}" r="${mobile ? 4 : 5}" fill="${badDebtColor}" stroke="white" stroke-width="1.5" ${isLive ? 'stroke-dasharray="2 1"' : ''}/>
        <text x="${x(i)}" y="${balancePointY - 9}" text-anchor="middle" font-size="${mobile ? 8 : 10}" font-weight="700" fill="${balanceColor}" stroke="white" stroke-width="2.5" paint-order="stroke">${formatTyDong(balances[i])}</text>
        <text x="${x(i)}" y="${badPointY - 9}" text-anchor="middle" font-size="${mobile ? 8 : 10}" font-weight="700" fill="${badDebtColor}" stroke="white" stroke-width="2.5" paint-order="stroke">${formatTrieuDong(badDebts[i])}</text>
        <text x="${x(i)}" y="${height - 7}" text-anchor="middle" font-size="${mobile ? 9 : 11}" font-weight="${m.yearMonth === selectedYm ? 700 : 500}" fill="#475569">${label}</text>
        <rect x="${x(i) - step * .43}" y="${top - 16}" width="${step * .86}" height="${bottom - top + 40}" fill="transparent"/>
        <title>${label}: Dư nợ ${formatVND(balances[i])}; nợ xấu ${formatVND(badDebts[i])}</title></g>`;
    }).join('');
    return `<div class="trend-scroll ${mobile ? 'monthly-trend-mobile' : 'monthly-trend-desktop'}"><svg viewBox="0 0 ${width} ${height}" style="width:${months.length > visible ? (width / viewport * 100).toFixed(2) : 100}%;display:block" role="img" aria-label="Biến động theo tháng: dư nợ tỷ đồng, nợ xấu triệu đồng">${grid}${line(balances, balanceY, balanceColor, false)}${line(badDebts, badY, badDebtColor, true)}${dots}</svg></div>`;
  };
  return `<div class="monthly-trend-note">Dư nợ: tỷ đồng (trục rút gọn) · Nợ xấu: triệu đồng (trục từ 0) · Kéo ngang để xem các tháng trước</div><div class="monthly-trend-legend"><span><i style="background:${balanceColor}"></i>Dư nợ</span><span><i style="background:${badDebtColor}"></i>Nợ xấu (trục riêng)</span></div>${renderSvg(false)}${renderSvg(true)}`;
}
