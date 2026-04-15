/** Aisle names are stored in Title Case (or user preference); UI shows ALL CAPS. */
export function formatAisleNameForDisplay(name) {
  if (name == null) return '';
  return String(name).toUpperCase();
}
