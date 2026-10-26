import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://amwiyxhawueqlmnzkdls.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtd2l5eGhhd3VlcWxtbnprZGxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNjgzODIsImV4cCI6MjEwMjc0NDM4Mn0.KlTd_BbDjH3ZPipXE76qshgXkusZzW8YfhoSDN_w8oE';

export const API_FN_URL = 'https://amwiyxhawueqlmnzkdls.supabase.co/functions/v1/create-account';

export function getSupabaseClient(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {},
  });
}

async function callApi(authToken, payload) {
  try {
    const res = await fetch(API_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${authToken || SUPABASE_ANON_KEY}` },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, reason: 'Không kết nối được máy chủ, kiểm tra lại mạng và thử lại.' };
  }
}

export async function callLoginFunction({ role, identifier, password }) {
  return callApi(null, { type: 'login', role, identifier, password });
}

export async function callForgotPasswordFunction({ cccd, phone }) {
  return callApi(null, { type: 'forgot-password', cccd, phone });
}

export async function callCreateAccountFunction(adminJwt, payload) {
  return callApi(adminJwt, payload);
}

export async function callImportDataFunction(adminJwt, payload) {
  return callApi(adminJwt, { type: 'import', ...payload });
}
