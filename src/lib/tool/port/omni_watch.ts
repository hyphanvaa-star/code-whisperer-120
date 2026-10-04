// Port of omni_watch.py state shape — INTERVAL_S must stay in sync with web.py.
export const INTERVAL_S = 60 * 60;

export type OmniWatchState = {
  enabled: boolean;
  last_at: number;
  last_file: string;
  last_path: string;
  last_count: number;
  last_error: string;
};

export function defaultState(): OmniWatchState {
  return { enabled: false, last_at: 0, last_file: "", last_path: "", last_count: 0, last_error: "" };
}

/** next tick given now() epoch seconds, like omni_watch's _next_at bump. */
export function nextRunAt(lastAt: number): number {
  return lastAt + INTERVAL_S;
}
