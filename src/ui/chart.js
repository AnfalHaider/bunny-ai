/**
 * Charts inside artifacts.
 *
 * An artifact whose content is a chart description is drawn as an SVG, so a
 * reply that is really data reads as a chart rather than as a wall of JSON.
 *
 * The description is plain data:
 *
 *   { "type": "bar", "title": "Spending", "labels": ["Jan", "Feb"], "values": [10, 24] }
 *
 * Nothing is fetched and no script runs: the chart is drawn from the numbers
 * that are in the artifact, and only those.
 */

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Is this content a chart description?
 * @param {string} content
 */
export function chartSpec(content) {
  const text = String(content ?? '').trim();
  if (!text.startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const type = String(parsed.type ?? '').toLowerCase();
  if (!['bar', 'line', 'pie'].includes(type)) return null;
  const values = Array.isArray(parsed.values) ? parsed.values.map(Number).filter(Number.isFinite) : [];
  if (!values.length) return null;
  const labels = Array.isArray(parsed.labels)
    ? parsed.labels.map(String)
    : values.map((_, index) => String(index + 1));
  return {
    type,
    title: String(parsed.title ?? ''),
    labels,
    values,
    colors: Array.isArray(parsed.colors) ? parsed.colors.map(String) : [],
  };
}

function node(name, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

function text(value, attrs = {}) {
  const el = node('text', attrs);
  el.textContent = value;
  return el;
}

const PALETTE = ['#4f7cff', '#e8734a', '#2fa36b', '#b5569b', '#d9a441', '#6b7280'];

/**
 * Draw a chart.
 * @param {{type: string, title?: string, labels: string[], values: number[], colors?: string[]}} spec
 * @returns {SVGElement}
 */
export function renderChart(spec) {
  const width = 640;
  const height = 320;
  const pad = { top: 30, right: 20, bottom: 44, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const colors = spec.colors?.length ? spec.colors : PALETTE;

  const svg = node('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    role: 'img',
    'aria-label': spec.title || `${spec.type} chart`,
    style: 'max-width:100%;height:auto',
  });

  if (spec.title) {
    svg.append(text(spec.title, { x: pad.left, y: 20, 'font-size': 14, 'font-weight': 600, fill: 'currentColor' }));
  }

  const max = Math.max(...spec.values, 0);
  const min = Math.min(...spec.values, 0);
  const span = max - min || 1;
  const zeroY = pad.top + plotH * (max / span);

  // The axis and its labels.
  svg.append(node('line', {
    x1: pad.left, y1: pad.top, x2: pad.left + plotW, y2: pad.top + plotH,
    stroke: 'currentColor', 'stroke-opacity': 0.18,
  }));
  svg.append(node('line', {
    x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH,
    stroke: 'currentColor', 'stroke-opacity': 0.18,
  }));

  for (let step = 0; step <= 4; step += 1) {
    const value = min + (span * step) / 4;
    const y = pad.top + plotH - (plotH * step) / 4;
    svg.append(text(format(value), {
      x: pad.left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.6,
    }));
  }

  if (spec.type === 'pie') {
    drawPie(svg, spec, { pad, plotW, plotH, colors });
  } else if (spec.type === 'line') {
    drawLine(svg, spec, { pad, plotW, plotH, zeroY, colors });
  } else {
    drawBars(svg, spec, { pad, plotW, plotH, zeroY, colors });
  }

  return svg;
}

function drawBars(svg, spec, { pad, plotW, plotH, zeroY, colors }) {
  const count = spec.values.length;
  const slot = plotW / Math.max(count, 1);
  const barW = Math.max(6, slot * 0.6);

  spec.values.forEach((value, index) => {
    const x = pad.left + slot * index + (slot - barW) / 2;
    const y = value >= 0 ? zeroY - ((value / (zeroY - pad.top)) * (pad.top + plotH - zeroY)) : zeroY;
    const h = Math.abs((value / (zeroY - pad.top)) * (pad.top + plotH - zeroY));
    svg.append(node('rect', {
      x, y: value >= 0 ? y : zeroY, width: barW, height: Math.max(1, h),
      fill: colors[index % colors.length], rx: 3,
    }));
    svg.append(text(spec.labels[index] ?? '', {
      x: x + barW / 2, y: pad.top + plotH + 18, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.7,
    }));
  });
}

function drawLine(svg, spec, { pad, plotW, plotH, zeroY, colors }) {
  const count = spec.values.length;
  const step = count > 1 ? plotW / (count - 1) : 0;
  const span = pad.top + plotH - zeroY || 1;

  const points = spec.values.map((value, index) => {
    const x = pad.left + step * index;
    const y = zeroY - (value / span) * (pad.top + plotH - zeroY);
    return `${x},${y}`;
  });

  svg.append(node('polyline', {
    points: points.join(' '), fill: 'none', stroke: colors[0], 'stroke-width': 2,
  }));
  spec.values.forEach((value, index) => {
    const [x, y] = points[index].split(',');
    svg.append(node('circle', { cx: x, cy: y, r: 3.5, fill: colors[0] }));
    svg.append(text(spec.labels[index] ?? '', {
      x, y: pad.top + plotH + 18, 'text-anchor': 'middle', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.7,
    }));
  });
}

function drawPie(svg, spec, { pad, plotW, plotH, colors }) {
  const total = spec.values.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  const radius = Math.min(plotW, plotH) / 2 - 10;
  const cx = pad.left + plotW / 3;
  const cy = pad.top + plotH / 2;
  let angle = -Math.PI / 2;

  spec.values.forEach((value, index) => {
    const slice = (Math.abs(value) / total) * Math.PI * 2;
    const end = angle + slice;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    const large = slice > Math.PI ? 1 : 0;
    svg.append(node('path', {
      d: `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`,
      fill: colors[index % colors.length],
    }));
    angle = end;
  });

  spec.values.forEach((value, index) => {
    const y = pad.top + 14 + index * 20;
    svg.append(node('rect', { x: pad.left + plotW - 130, y: y - 9, width: 11, height: 11, rx: 2, fill: colors[index % colors.length] }));
    svg.append(text(`${spec.labels[index] ?? ''} · ${format(value)}`, {
      x: pad.left + plotW - 112, y, 'font-size': 12, fill: 'currentColor',
    }));
  });
}

function format(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
