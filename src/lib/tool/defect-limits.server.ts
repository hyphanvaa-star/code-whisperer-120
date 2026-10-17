import type { Ctx } from './types';
import { getJson, setJson } from './store.server';
import { mergeDefectLimits, type AircraftLimit } from './port/defect_limits';
export async function saveDefectSummary(ctx: Ctx, summary: { aircraft: AircraftLimit[]; [key: string]: unknown }) {
  const previous = await getJson<{ aircraft?: AircraftLimit[] }>(ctx, 'defect.summary', {});
  const limits = await getJson<Record<string, unknown>>(ctx, 'limits', {});
  const current = Array.isArray(limits['aircraft']) ? limits['aircraft'] as AircraftLimit[] : [];
  const aircraft = mergeDefectLimits(current, previous.aircraft ?? [], summary.aircraft);
  await setJson(ctx, 'limits', { ...limits, aircraft });
  await setJson(ctx, 'defect.summary', summary);
  return aircraft;
}
