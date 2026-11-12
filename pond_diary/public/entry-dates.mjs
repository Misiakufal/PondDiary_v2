export function dateInput(value = Date.now()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function parseEntryDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || dateInput(date) !== value) {
    throw new Error("Enter a valid date and time. Choose a different time if clocks skip over it.");
  }
  return date.toISOString();
}
