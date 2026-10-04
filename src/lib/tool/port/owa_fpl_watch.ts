// Port of owa_fpl_watch.py — status/response shape only; the live mailbox watch
// needs OWA_USER/OWA_PASS and Exchange/OWA access (see autoload.server.ts).
export type OwaFplStatus = {
  running: boolean;
  last_at: number;
  count: number;
  items: Array<{ id: number; subject: string; at: string }>;
  error: string;
};

export function emptyStatus(error = ""): OwaFplStatus {
  return { running: false, last_at: 0, count: 0, items: [], error };
}
