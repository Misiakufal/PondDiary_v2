import { init } from "./echarts.mjs";
import { parameters } from "./parameters.mjs";

export const seriesColors = {
  ph: "#efba72", no2: "#7bc8ff", no3: "#69dbc3", po4: "#e3a4ff", nh4: "#ff9da9",
  gh: "#f7df7e", kh: "#f3b1d5", cu: "#abc0ff", o2: "#a8e49a"
};

export function mountWaterChart(container, readings, enabled, bounds, window, { onRange, onPoint, formatPoint }) {
  const chart = init(container, undefined, { renderer: "canvas" });
  const [first, last] = bounds;
  const [startValue, endValue] = window;
  const zoomable = first < last;
  const axisLabel = { color: "#b9cce4", fontSize: 11, hideOverlap: true };
  const axisLine = { show: true, lineStyle: { color: "#58769b" } };
  const nameTextStyle = { color: "#dbe9fb", fontWeight: "bold" };
  const yAxis = (name, position, showGrid) => ({
    type: "value", name, position, nameTextStyle, axisLabel, axisLine, min: 0,
    splitNumber: 5, splitLine: { show: showGrid, lineStyle: { color: "#385577" } }
  });

  chart.setOption({
    animation: false,
    grid: { left: 50, right: 50, top: 36, bottom: 36 },
    tooltip: {
      trigger: "item",
      triggerOn: "click",
      renderMode: "richText",
      confine: true,
      backgroundColor: "#132541",
      borderColor: "#58769b",
      textStyle: { color: "#eff6ff", fontSize: 12 },
      formatter: ({ seriesId, value }) => formatPoint(seriesId, ...value)
    },
    xAxis: {
      type: "time",
      min: zoomable ? first : first - 30 * 60_000,
      max: zoomable ? last : last + 30 * 60_000,
      axisLabel,
      axisLine,
      splitNumber: 5
    },
    yAxis: [yAxis("mg/L", "left", true), yAxis("Unitless", "right", false)],
    dataZoom: zoomable ? [{
      id: "water-time",
      type: "inside",
      xAxisIndex: 0,
      filterMode: "none",
      startValue,
      endValue,
      minValueSpan: Math.min(60_000, last - first),
      zoomOnMouseWheel: "shift",
      moveOnMouseMove: true,
      preventDefaultMouseMove: false
    }] : []
  });

  function setSeries(selected) {
    const series = Object.entries(parameters).filter(([key]) => selected.has(key)).map(([key, parameter]) => ({
      id: key,
      name: parameter.label,
      type: "line",
      yAxisIndex: parameter.unit ? 0 : 1,
      data: readings.get(key) ?? [],
      showSymbol: true,
      symbol: "circle",
      symbolSize: 9,
      lineStyle: { width: 2, color: seriesColors[key] },
      itemStyle: { color: seriesColors[key] }
    }));
    chart.setOption({ series }, { replaceMerge: ["series"] });
  }

  setSeries(enabled);
  chart.on("click", { seriesType: "line" }, ({ seriesId, value }) => {
    if (Array.isArray(value)) onPoint(formatPoint(seriesId, ...value));
  });
  chart.on("datazoom", () => {
    const [zoom] = chart.getOption().dataZoom;
    if (zoom) onRange(zoom.startValue, zoom.endValue);
  });
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(container);

  return {
    setSeries,
    setRange(startValue, endValue) {
      chart.dispatchAction({ type: "dataZoom", dataZoomId: "water-time", startValue, endValue }, { silent: true });
    },
    dispose() {
      observer.disconnect();
      chart.dispose();
    }
  };
}
