import { FUEL_LEVELS } from './returns.js';

/**
 * Handover condition report (pick-up and drop-off).
 *
 * A rental dispute almost always comes down to "what did the car look like when
 * I took it?" — fuel, odometer, cleanliness and pre-existing damage. This module
 * is the single source of truth for validating and describing that record so the
 * demo adapter, the Supabase adapter and both desks agree on every rule.
 */

export const CLEANLINESS = Object.freeze(['clean', 'average', 'dirty']);

export const CLEANLINESS_LABELS = Object.freeze({
  clean: 'Clean',
  average: 'Average',
  dirty: 'Needs cleaning',
});

export const DAMAGE_AREAS = Object.freeze([
  { key: 'front', label: 'Front bumper' },
  { key: 'rear', label: 'Rear bumper' },
  { key: 'left', label: 'Left side' },
  { key: 'right', label: 'Right side' },
  { key: 'windscreen', label: 'Windscreen' },
  { key: 'mirrors', label: 'Mirrors' },
  { key: 'wheels', label: 'Wheels & tyres' },
  { key: 'interior', label: 'Interior' },
  { key: 'roof', label: 'Roof' },
]);

export const DAMAGE_KEYS = Object.freeze(DAMAGE_AREAS.map((area) => area.key));

/** Same ceiling the workshop log and the SQL odometer guard use. */
export const MAX_ODOMETER = 2000000;

export const MAX_NOTE = 500;

const wholeNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
};

/**
 * Problems with a condition record, in the order the operator should fix them.
 * `minOdometer` is the pick-up reading when validating a drop-off, so a return
 * can never "un-drive" the car.
 */
export function inspectionProblems(input = {}, { minOdometer = null, requireOdometer = true } = {}) {
  const problems = [];
  const odometer = wholeNumber(input.odometer);
  if (odometer === null) {
    if (input.odometer === '' || input.odometer === null || input.odometer === undefined) {
      if (requireOdometer) problems.push('Enter the odometer reading in kilometres.');
    } else {
      problems.push('Odometer must be a whole number of kilometres.');
    }
  } else if (odometer < 0) {
    problems.push('Odometer cannot be negative.');
  } else if (odometer > MAX_ODOMETER) {
    problems.push('Keep the odometer under 20,00,000 km.');
  } else if (minOdometer !== null && odometer < Number(minOdometer)) {
    problems.push(`Odometer cannot be lower than the pick-up reading (${Number(minOdometer).toLocaleString('en-IN')} km).`);
  }

  if (!FUEL_LEVELS.includes(input.fuel)) problems.push('Choose the fuel or battery level.');
  if (!CLEANLINESS.includes(input.cleanliness)) problems.push('Choose how clean the vehicle is.');

  const note = String(input.note ?? input.damageNote ?? '').trim();
  if (note.length > MAX_NOTE) problems.push(`Keep the condition note under ${MAX_NOTE} characters.`);

  return problems;
}

/** Sanitised record — call only after `inspectionProblems` returns an empty list. */
export function normalizeInspection(input = {}) {
  const damage = Array.isArray(input.damage)
    ? [...new Set(input.damage.filter((key) => DAMAGE_KEYS.includes(key)))]
    : [];
  return {
    odometer: Number(input.odometer),
    fuel: FUEL_LEVELS.includes(input.fuel) ? input.fuel : 'Full',
    cleanliness: CLEANLINESS.includes(input.cleanliness) ? input.cleanliness : 'clean',
    damage,
    note: String(input.note ?? input.damageNote ?? '').trim().slice(0, MAX_NOTE),
  };
}

/**
 * Validate a drop-off record against the pick-up one.
 *
 * The odometer is mandatory only when the car was handed over with a record —
 * a legacy trip without a pick-up reading must still be settleable.
 */
export function returnCondition(input = {}, { pickupOdometer = null } = {}) {
  const required = pickupOdometer !== null && pickupOdometer !== undefined && pickupOdometer !== '';
  const problems = inspectionProblems(input, {
    minOdometer: required ? Number(pickupOdometer) : null,
    requireOdometer: required,
  });
  if (problems.length) throw new Error(problems[0]);
  return {
    odometer: wholeNumber(input.odometer),
    cleanliness: CLEANLINESS.includes(input.cleanliness) ? input.cleanliness : null,
  };
}

// The odometer maths now lives in the kilometre engine so the allowance and
// the driven distance use exactly the same reading rules. Re-exported here to
// keep every existing `inspection.js` import working.
export { kmDriven } from './km.js';

export const damageLabels = (keys = []) => DAMAGE_AREAS
  .filter((area) => (Array.isArray(keys) ? keys : []).includes(area.key))
  .map((area) => area.label);

/**
 * One-line description used by the desk and the returns board.
 * Always returns something meaningful, even for an untracked handover.
 */
export function inspectionLine(inspection) {
  if (!inspection) return 'No condition report on file';
  const parts = [];
  const odometer = wholeNumber(inspection.odometer);
  if (odometer !== null) parts.push(`${odometer.toLocaleString('en-IN')} km`);
  if (FUEL_LEVELS.includes(inspection.fuel)) parts.push(`Fuel ${inspection.fuel}`);
  if (CLEANLINESS.includes(inspection.cleanliness)) parts.push(CLEANLINESS_LABELS[inspection.cleanliness]);
  if (Array.isArray(inspection.damage) && inspection.damage.length) {
    const labels = damageLabels(inspection.damage);
    if (labels.length) parts.push(`Damage: ${labels.join(', ')}`);
  }
  if (!parts.length) return 'Condition report on file';
  return parts.join(' · ');
}
