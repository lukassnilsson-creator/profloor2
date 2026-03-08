import { supabase } from './supabase';

function getSessionId(): string {
  let id = localStorage.getItem('pf_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('pf_session_id', id);
  }
  return id;
}

export async function logEvent(eventType: string, userId?: string | null) {
  try {
    const { error } = await supabase.from('app_events').insert({
      event_type: eventType,
      user_id: userId ?? null,
      session_id: getSessionId(),
    });
    if (error) console.error('[analytics] logEvent error:', eventType, error.message);
  } catch (err) {
    console.error('[analytics] logEvent exception:', eventType, err);
  }
}
