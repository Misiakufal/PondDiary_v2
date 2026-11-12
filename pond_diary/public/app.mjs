import { parameters } from "./parameters.mjs";
import { plot } from "./charts.mjs";

const content = document.querySelector("#content");
const error = document.querySelector("#error");
const notice = document.querySelector("#notice");
const entryDialog = document.querySelector("#entry-dialog");
const productDialog = document.querySelector("#product-dialog");
const confirmDialog = document.querySelector("#confirm-dialog");
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const motion = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
const kinds = { test: "Water test", treatment: "Treatment", event: "Event", photo: "Photo" };
const views = {
  journal: ["Pond journal", "Pond activity", "Water tests, treatments, events, and photos"],
  photos: ["Pond journal", "Pond photos", "Photos and observations from the pond"],
  trends: ["Water quality", "Water trends", "Choose the parameters you want to track"],
  products: ["Pond care", "Product library", "Products you can select when logging a treatment"]
};
const state = {
  view: "journal", filter: "all", entries: [], products: [], enabled: new Set(Object.keys(parameters)), loaded: false
};
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const formatDate = value => dateFormat.format(new Date(value));
const readingLabel = entry => {
  const { label, unit } = parameters[entry.parameter];
  return `${label} · ${entry.value}${unit ? ` ${unit}` : ""}`;
};
const imageUrl = (collection, id) => `./api/${collection}/${id}/image`;
const titleFor = entry => entry.kind === "test" ? readingLabel(entry) : entry.kind === "treatment" ? entry.productName : entry.title;
const tagList = tags => tags.map(tag => `<span class="tag">#${escape(tag)}</span>`).join("");

async function api(path, method = "GET", data) {
  const response = await fetch(`./api/${path}`, {
    method, ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
  });
  if (response.status === 204) return;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}

async function refresh() {
  try {
    const journal = await api("journal");
    Object.assign(state, journal, { loaded: true });
    error.hidden = true;
    render();
    return true;
  } catch {
    error.textContent = "Could not load the journal.";
    error.hidden = false;
    if (!state.loaded) content.innerHTML = '<button type="button" data-action="retry">Try again</button>';
    return false;
  } finally {
    content.setAttribute("aria-busy", "false");
  }
}

function tile(entry, gallery) {
  const title = titleFor(entry);
  const summary = entry.description ?? [entry.dose, entry.notes].filter(Boolean).join(" · ");
  const photo = entry.hasImage && (entry.kind === "photo" || entry.kind === "event");
  const image = photo ? `<img src="${imageUrl("entries", entry.id)}" alt="" loading="lazy">` : "";
  return `<li><button type="button" class="tile" data-action="entry" data-id="${entry.id}" data-kind="${entry.kind}">
    <span class="tile-top"><span class="tile-label">${kinds[entry.kind]}</span><time class="meta" datetime="${entry.occurred}">${formatDate(entry.occurred)}</time></span>
    ${gallery && image ? `<span class="gallery-image">${image}</span>` : ""}
    <span class="tile-main"><span class="tile-copy"><span class="tile-title">${escape(title)}</span>
      ${summary ? `<span class="meta tile-summary">${escape(summary)}</span>` : ""}
      ${(gallery || entry.kind === "event") && entry.tags?.length ? `<span>${tagList(entry.tags)}</span>` : ""}</span>
      ${!gallery && image ? `<span class="tile-thumb">${image}</span>` : ""}
    </span>
  </button></li>`;
}

function renderJournal(gallery) {
  const visible = state.entries.filter(entry => gallery ? entry.kind === "photo" : state.filter === "all" || entry.kind === state.filter);
  const filters = Object.entries({ all: "All", test: "Water tests", treatment: "Treatments", event: "Events", photo: "Photos" });
  const empty = gallery ? "No pond photos yet. Use Add entry to upload one."
    : state.filter === "all" ? "No entries yet. Use Add entry to record something about your pond."
    : "No entries in this category.";
  content.innerHTML = `<div class="tools">
    ${gallery ? "" : `<div class="filters" role="group" aria-label="Filter entries">${filters.map(([value, label]) => `
      <button type="button" data-filter="${value}" aria-pressed="${state.filter === value}">${label}</button>`).join("")}</div>`}
    <span class="count">${visible.length} ${visible.length === 1 ? "entry" : "entries"} · Newest first</span>
  </div>
  ${visible.length ? `<ol class="tiles${gallery ? " gallery" : ""}">${visible.map(entry => tile(entry, gallery)).join("")}</ol>`
    : `<p class="empty">${empty}</p>`}`;
}

function renderProducts() {
  content.innerHTML = `<div class="tools"><span class="count">${state.products.length} ${state.products.length === 1 ? "product" : "products"}</span>
    <button type="button" class="primary" data-action="add-product">Add product</button></div>
    ${state.products.length ? `<ul class="tiles">${state.products.map(product => `
      <li><button type="button" class="tile" data-action="product" data-id="${product.id}" data-kind="treatment">
        <span class="tile-label">Treatment product</span>
        <span class="tile-main"><span class="tile-copy"><span class="tile-title">${escape(product.name)}</span>
        <span class="meta tile-summary">${escape(product.description)}</span></span>
        ${product.hasImage ? `<span class="tile-thumb"><img src="${imageUrl("products", product.id)}" alt="" loading="lazy"></span>` : ""}</span>
      </button></li>`).join("")}</ul>` : '<p class="empty">Your product library is empty. Add a product here or while logging a treatment.</p>'}`;
}

let chartObserver;
let trendBounds;
let trendWindow;

function setTrendWindow(start, duration) {
  const [first, last] = trendBounds;
  const width = Math.min(duration, last - first);
  const left = Math.max(first, Math.min(start, last - width));
  trendWindow = width === last - first ? undefined : [left, left + width];
}

function moveTrendWindow(action) {
  const [start, end] = trendWindow ?? trendBounds;
  const width = end - start;
  const minimum = Math.min(60_000, trendBounds[1] - trendBounds[0]);
  switch (action) {
    case "in": {
      const duration = Math.max(minimum, Math.ceil(width / 2));
      setTrendWindow(end - duration, duration);
      break;
    }
    case "out": setTrendWindow(end - width * 2, width * 2); break;
    case "earlier": setTrendWindow(start - Math.ceil(width / 2), width); break;
    case "later": setTrendWindow(start + Math.ceil(width / 2), width); break;
    case "reset": trendWindow = undefined; break;
  }
}

function renderTrends() {
  const tests = state.entries.filter(entry => entry.kind === "test").reverse();
  trendBounds = tests.length ? [Date.parse(tests[0].occurred), Date.parse(tests.at(-1).occurred)] : undefined;
  if (!trendBounds) trendWindow = undefined;
  else if (trendWindow) setTrendWindow(trendWindow[0], trendWindow[1] - trendWindow[0]);
  const dates = trendWindow ?? trendBounds;
  const visible = trendWindow ? tests.filter(entry => {
    const time = Date.parse(entry.occurred);
    return time >= dates[0] && time <= dates[1];
  }) : tests;
  const grouped = Map.groupBy(visible, entry => entry.parameter);
  const active = Object.entries(parameters).filter(([key]) => state.enabled.has(key) && grouped.has(key));
  const zoomable = trendBounds && trendBounds[0] < trendBounds[1];
  const controls = zoomable ? [
    ["in", "Zoom in", dates[1] - dates[0] <= 60_000],
    ["out", "Zoom out", !trendWindow],
    ["earlier", "Earlier", dates[0] === trendBounds[0]],
    ["later", "Later", dates[1] === trendBounds[1]],
    ["reset", "Full history", !trendWindow]
  ] : [];
  const empty = !tests.length ? "Log a water test to start tracking trends."
    : !visible.length ? "No readings in this time range."
    : "Select a parameter with readings in this time range.";
  content.innerHTML = `<div class="series" role="group" aria-label="Visible water test parameters">
    ${Object.entries(parameters).map(([key, { label }]) => `<label><input type="checkbox" data-series="${key}" ${state.enabled.has(key) ? "checked" : ""}>${label}</label>`).join("")}
    </div>
    ${zoomable ? `<div class="time-range" role="group" aria-label="Chart time range" aria-describedby="trend-window-label">
      <div class="actions">${controls.map(([action, label, disabled]) => `
        <button type="button" data-time="${action}" aria-disabled="${disabled}">${label}</button>`).join("")}</div>
      <p class="meta" id="trend-window-label">${escape(dateFormat.formatRange(dates[0], dates[1]))}</p>
    </div>` : ""}
    <div id="chart-results">${active.length ? `<ul class="tiles">${active.map(([key, { label, unit }]) => `
      <li class="chart"><h2>${label}${unit ? ` <span class="meta">(${unit})</span>` : ""}</h2>
        <canvas data-chart="${key}" role="img" aria-label="${label} over time"></canvas>
        <details><summary>${grouped.get(key).length} ${grouped.get(key).length === 1 ? "reading" : "readings"}</summary><table><thead><tr><th scope="col">Date and time</th><th scope="col">Value</th></tr></thead>
        <tbody>${grouped.get(key).map(reading => `<tr><td>${formatDate(reading.occurred)}</td><td>${reading.value}</td></tr>`).join("")}</tbody></table></details>
      </li>`).join("")}</ul>`
    : `<p class="empty">${empty}</p>`}</div>`;
  if (!active.length) return;
  chartObserver = new ResizeObserver(items => {
    for (const { target } of items) plot(target, grouped.get(target.dataset.chart), dates);
  });
  content.querySelectorAll("[data-chart]").forEach(canvas => chartObserver.observe(canvas));
}

function render(animate = false) {
  chartObserver?.disconnect();
  const [label, heading, subtitle] = views[state.view];
  document.querySelector("#section-label").textContent = label;
  document.querySelector("#heading").textContent = heading;
  document.querySelector("#subtitle").textContent = subtitle;
  document.querySelectorAll("[data-view]").forEach(button => {
    if (button.dataset.view === state.view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (!state.loaded) return;
  if (state.view === "products") renderProducts();
  else if (state.view === "trends") renderTrends();
  else renderJournal(state.view === "photos");
  if (animate) (content.querySelector(".tiles") ?? content.lastElementChild)?.classList.add("enter");
}

function dialogHead(dialog, title) {
  return `<div class="dialog-head"><h2 id="${dialog.id.replace("dialog", "heading")}">${escape(title)}</h2>
    <button type="button" data-action="close">Close</button></div>`;
}

function show(dialog, markup) {
  dialog.innerHTML = markup;
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector("button")?.focus();
}

function showEntry(entry) {
  const { id, kind } = entry;
  const notes = entry.description ?? entry.notes;
  const reading = kind === "test" ? parameters[entry.parameter] : null;
  show(entryDialog, `${dialogHead(entryDialog, kind === "test" ? "Water test" : titleFor(entry))}
    <div class="detail"><p class="meta">${kinds[kind]} · ${formatDate(entry.occurred)}</p>
    ${reading ? `<p class="reading">${reading.label} · ${entry.value}${reading.unit ? ` ${reading.unit}` : ""}</p>` : ""}
    ${entry.dose ? `<p>Dose: ${escape(entry.dose)}</p>` : ""}
    ${entry.hasImage ? `<img class="detail-image" src="${imageUrl("entries", id)}" alt="${kind === "photo" ? escape(entry.title) : "Entry attachment"}">` : ""}
    ${notes ? `<p>${escape(notes)}</p>` : ""}
    ${entry.tags?.length ? `<p>${tagList(entry.tags)}</p>` : ""}
    <div class="actions"><button type="button" data-action="edit-entry" data-id="${id}">Edit entry</button>
      <button type="button" class="danger" data-action="delete-entry" data-id="${id}">Remove entry</button></div></div>`);
}

function dateInput(value) {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function attachmentField(hasImage, required = false, allowRemove = true) {
  return `<label>${required ? "Photo" : hasImage ? "Replace photo" : "Photo (optional)"}
    <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" ${required ? "required" : ""}>
  </label><p class="help">JPEG, PNG, WebP, or GIF · Up to 4 MB</p>
  ${hasImage && allowRemove ? '<label class="inline-check"><input type="checkbox" name="removeImage"> Remove current photo</label>' : ""}`;
}

function productOptions(selected, savedName) {
  const removed = selected && savedName && !state.products.some(product => product.id === selected);
  return `<option value="">Select product</option>${removed ? `<option value="${selected}" selected>${escape(savedName)} (removed)</option>` : ""}
    ${state.products.map(product => `<option value="${product.id}" ${product.id === selected ? "selected" : ""}>${escape(product.name)}</option>`).join("")}`;
}

function entryFields(form, entry = {}) {
  const kind = form.elements.kind.value;
  const fields = form.querySelector(".form-fields");
  if (kind === "test") {
    fields.innerHTML = `<div class="form-pair"><label>Parameter<select name="parameter">
      ${Object.entries(parameters).map(([key, { label }]) => `<option value="${key}" ${entry.parameter === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label><span id="reading-label">Value</span><input type="number" name="value" min="0" step="any" required value="${entry.value ?? ""}"></label></div>`;
    updateReading(form);
  } else if (kind === "treatment") {
    fields.innerHTML = `<label>Product<select name="productId" required>${productOptions(entry.productId, entry.productName)}</select></label>
      <div><button type="button" data-action="add-product-inline">Add a product</button></div>
      <label>Dose<input name="dose" maxlength="120" placeholder="e.g. 25 mL" value="${escape(entry.dose)}"></label>`;
  } else {
    fields.innerHTML = `<label>Title<input name="title" maxlength="120" required value="${escape(entry.title)}"></label>
      <label>Description<textarea name="description" rows="3" maxlength="2000">${escape(entry.description)}</textarea></label>
      <label>Hashtags<input name="tags" maxlength="660" placeholder="#lilies #spring" value="${escape(entry.tags?.map(tag => `#${tag}`).join(" "))}"></label>`;
  }
  if (kind === "test" || kind === "treatment") {
    fields.insertAdjacentHTML("beforeend", `<label>Notes<textarea name="notes" maxlength="2000" rows="2">${escape(entry.notes)}</textarea></label>`);
  }
  fields.insertAdjacentHTML("beforeend", attachmentField(entry.hasImage, kind === "photo" && !entry.hasImage, kind !== "photo"));
}

function updateReading(form) {
  const parameter = parameters[form.elements.parameter.value];
  form.querySelector("#reading-label").textContent = parameter.unit ? `Value (${parameter.unit})` : "Value";
  form.elements.value.max = parameter.max ?? "";
}

function entryForm(entry) {
  const initial = entry?.kind || (state.view === "photos" ? "photo" : kinds[state.filter] ? state.filter : "test");
  show(entryDialog, `${dialogHead(entryDialog, entry ? "Edit entry" : "Add entry")}
    <form data-form="entry" data-id="${entry?.id ?? ""}">
    <div class="form-pair"><label>Entry type<select name="kind" ${entry ? "disabled" : ""}>
      ${Object.entries(kinds).map(([key, label]) => `<option value="${key}" ${key === initial ? "selected" : ""}>${label}</option>`).join("")}
    </select></label><label>Date and time<input type="datetime-local" name="occurred" required value="${dateInput(entry?.occurred)}"></label></div>
    <div class="form-fields"></div><p class="error" role="alert" hidden></p>
    <div class="actions"><button type="submit" class="primary">Save entry</button></div></form>`);
  entryFields(entryDialog.querySelector("form"), entry);
}

function productForm(product, inline = false) {
  show(productDialog, `${dialogHead(productDialog, product ? "Edit product" : "Add product")}
    <form data-form="product" data-id="${product?.id ?? ""}" ${inline ? "data-inline" : ""}>
      <label>Product name<input name="name" required maxlength="120" value="${escape(product?.name)}"></label>
      <label>Description<textarea name="description" maxlength="2000" rows="3">${escape(product?.description)}</textarea></label>
      ${attachmentField(product?.hasImage)}
      <p class="error" role="alert" hidden></p><div class="actions"><button type="submit" class="primary">Save product</button>
      ${product ? `<button type="button" class="danger" data-action="delete-product" data-id="${product.id}">Remove product</button>` : ""}</div>
    </form>`);
  if (product?.hasImage) {
    productDialog.querySelector("form").insertAdjacentHTML("afterbegin", `<img class="detail-image" src="${imageUrl("products", product.id)}" alt="${escape(product.name)}">`);
  }
}

function confirmRemove(collection, id) {
  const product = collection === "products";
  const label = product ? "product" : "entry";
  show(confirmDialog, `${dialogHead(confirmDialog, `Remove ${label}?`)}
    <form data-form="delete" data-collection="${collection}" data-id="${id}">
      <p>${product ? "This removes the product from the library. Existing treatments keep the saved product name." : "This permanently removes the entry and its photo."}</p>
      <p class="error" role="alert" hidden></p>
      <div class="actions"><button type="button" data-action="close">Cancel</button><button type="submit" class="danger">Remove ${label}</button></div>
    </form>`);
}

async function readAttachment(form, data) {
  const file = form.elements.image?.files[0];
  if (!file) {
    if (data.removeImage) data.image = null;
    else delete data.image;
  } else {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 4 * 1024 * 1024) {
      throw new Error("Choose a JPEG, PNG, WebP, or GIF image under 4 MB.");
    }
    data.image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the photo."));
      reader.readAsDataURL(file);
    });
  }
  delete data.removeImage;
}

async function submitForm(form) {
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector(".error");
  if (button.disabled) return;
  button.disabled = true;
  message.hidden = true;
  const { id, collection, form: type } = form.dataset;
  const dialog = form.closest("dialog");
  const close = dialog.querySelector('[data-action="close"]');
  close.disabled = true;
  dialog.setAttribute("aria-busy", "true");
  try {
    if (type === "delete") {
      await api(`${collection}/${id}`, "DELETE");
      dialog.close();
      (collection === "entries" ? entryDialog : productDialog).close();
      notice.textContent = collection === "entries" ? "Entry removed." : "Product removed.";
      await refresh();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    if (type === "entry") {
      data.kind = form.elements.kind.value;
      data.occurred = new Date(data.occurred).toISOString();
      if (data.kind === "test") data.value = Number(data.value);
      if ("tags" in data) data.tags = data.tags.split(/[\s,]+/u).map(tag => tag.replace(/^#+/, "")).filter(Boolean);
    }
    await readAttachment(form, data);
    const resource = type === "entry" ? "entries" : "products";
    const result = await api(id ? `${resource}/${id}` : resource, id ? "PUT" : "POST", data);
    if (type === "entry" && !id) {
      if (state.view !== "photos" || data.kind !== "photo") state.view = "journal";
      state.filter = "all";
    }
    dialog.close();
    notice.textContent = type === "entry" ? "Entry saved." : "Product saved.";
    const loaded = await refresh();
    if (type === "entry" && loaded) {
      content.querySelector(`[data-id="${result.id}"]`)?.classList.add("enter");
    } else if (type === "product" && form.hasAttribute("data-inline") && entryDialog.open) {
      const select = entryDialog.querySelector('select[name="productId"]');
      if (select) {
        if (loaded) select.innerHTML = productOptions(result.id);
        else select.add(new Option(data.name, result.id, true, true));
        select.focus();
      }
    }
  } catch (exception) {
    message.textContent = exception.message;
    message.hidden = false;
  } finally {
    button.disabled = false;
    close.disabled = false;
    dialog.removeAttribute("aria-busy");
  }
}

for (const dialog of [entryDialog, productDialog, confirmDialog]) {
  dialog.addEventListener("cancel", event => {
    if (dialog.getAttribute("aria-busy") === "true") event.preventDefault();
  });
}

document.addEventListener("submit", event => {
  if (!event.target.matches("[data-form]")) return;
  event.preventDefault();
  void submitForm(event.target);
});

document.addEventListener("change", event => {
  const input = event.target;
  if (input.matches("[data-series]")) {
    const key = input.dataset.series;
    if (input.checked) state.enabled.add(key);
    else state.enabled.delete(key);
    render();
    content.querySelector(`[data-series="${key}"]`).focus();
  } else if (input.form?.dataset.form === "entry") {
    if (input.name === "kind") entryFields(input.form);
    else if (input.name === "parameter") updateReading(input.form);
  }
});

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const { view, filter, action, id, time } = button.dataset;
  if (time) {
    if (button.getAttribute("aria-disabled") === "true") return;
    moveTrendWindow(time);
    render();
    content.querySelector(`[data-time="${time}"]`).focus();
    return;
  }
  if (view && view !== state.view) {
    state.view = view;
    render(true);
  } else if (filter && filter !== state.filter) {
    state.filter = filter;
    render(true);
    content.querySelector(`[data-filter="${filter}"]`).focus();
  }
  if (!action) return;
  const entry = id && state.entries.find(item => item.id === id);
  const product = id && state.products.find(item => item.id === id);
  switch (action) {
    case "retry": void refresh(); break;
    case "add": entryForm(); break;
    case "entry": if (entry) showEntry(entry); break;
    case "edit-entry": if (entry) entryForm(entry); break;
    case "delete-entry": if (entry) confirmRemove("entries", id); break;
    case "add-product": productForm(); break;
    case "add-product-inline": productForm(undefined, true); break;
    case "product": if (product) productForm(product); break;
    case "delete-product": if (product) confirmRemove("products", id); break;
    case "close": {
      const dialog = button.closest("dialog");
      if (dialog.getAttribute("aria-busy") !== "true") dialog.close();
      break;
    }
  }
});

content.addEventListener("pointermove", event => {
  if (!motion.matches || event.pointerType !== "mouse") return;
  const tile = event.target.closest(".tile");
  if (!tile) return;
  // Measure the stable grid cell so the transform does not feed back into the tilt.
  const rect = tile.parentElement.getBoundingClientRect();
  const horizontal = Math.max(-1, Math.min(1, (event.clientX - rect.left) * 2 / rect.width - 1));
  const vertical = Math.max(-1, Math.min(1, (event.clientY - rect.top) * 2 / rect.height - 1));
  tile.style.setProperty("--tilt-x", `${(-vertical * 2.3).toFixed(2)}deg`);
  tile.style.setProperty("--tilt-y", `${(horizontal * 2.3).toFixed(2)}deg`);
});

content.addEventListener("pointerout", event => {
  const tile = event.target.closest(".tile");
  if (tile && !tile.contains(event.relatedTarget)) {
    tile.style.removeProperty("--tilt-x");
    tile.style.removeProperty("--tilt-y");
  }
});

function drawWaves(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const light = ctx.createLinearGradient(0, 0, 600, 0);
  light.addColorStop(0, "#7fbaff00");
  light.addColorStop(.35, "#7fbaff50");
  light.addColorStop(.72, "#b2daff99");
  light.addColorStop(1, "#8ac7ff4a");
  ctx.strokeStyle = light;
  for (let band = 0; band < 6; band++) {
    const offset = band * 12;
    ctx.globalAlpha = 1 - band * .09;
    ctx.lineWidth = band === 1 ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 131 + offset);
    ctx.bezierCurveTo(83, 142 + offset, 142, 53 + offset, 218, 55 + offset);
    ctx.bezierCurveTo(289, 55 + offset, 326, 119 + offset, 391, 104 + offset);
    ctx.bezierCurveTo(465, 88 + offset, 486, 18 + offset, 600, 29 + offset);
    ctx.stroke();
  }
}

drawWaves(document.querySelector(".waves"));
void refresh();
