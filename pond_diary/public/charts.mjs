const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const yearLabel = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const valueLabel = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 });

export function plot(canvas, readings, dates) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.font = "12px system-ui";

  const values = readings.map(reading => reading.value);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const padding = high > low ? (high - low) * .08 : Math.max(high * .1, .01);
  low = Math.max(0, low - padding);
  high += padding;
  const ticks = Array.from({ length: 4 }, (_, index) => low + index * (high - low) / 3);
  const left = Math.max(...ticks.map(value => ctx.measureText(valueLabel.format(value)).width)) + 9;
  const right = width - 6;
  const top = 13;
  const bottom = height - 26;
  const [first, last] = dates;
  const x = date => first === last ? (left + right) / 2 : left + (Date.parse(date) - first) * (right - left) / (last - first);
  const y = value => bottom - (value - low) * (bottom - top) / (high - low);

  ctx.fillStyle = "#b9cce4";
  ctx.strokeStyle = "#385577";
  ctx.textBaseline = "middle";
  for (const tick of ticks) {
    const line = y(tick);
    ctx.fillText(valueLabel.format(tick), 0, line);
    ctx.beginPath();
    ctx.moveTo(left, line);
    ctx.lineTo(right, line);
    ctx.stroke();
  }
  ctx.textBaseline = "top";
  const sameDay = new Date(first).toDateString() === new Date(last).toDateString();
  const differentYears = new Date(first).getFullYear() !== new Date(last).getFullYear();
  const formatter = first !== last && sameDay ? timeLabel : differentYears ? yearLabel : dateLabel;
  const startLabel = formatter.format(first);
  const endLabel = formatter.format(last);
  ctx.fillText(startLabel, left, bottom + 8);
  if (endLabel !== startLabel && ctx.measureText(startLabel).width + ctx.measureText(endLabel).width + 8 <= right - left) {
    ctx.textAlign = "right";
    ctx.fillText(endLabel, right, bottom + 8);
  }

  ctx.strokeStyle = "#8bc8ff";
  ctx.fillStyle = "#a6d7ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  readings.forEach((reading, index) => {
    const point = [x(reading.occurred), y(reading.value)];
    if (index === 0) ctx.moveTo(...point);
    else ctx.lineTo(...point);
  });
  ctx.stroke();
  for (const reading of readings) {
    ctx.beginPath();
    ctx.arc(x(reading.occurred), y(reading.value), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
