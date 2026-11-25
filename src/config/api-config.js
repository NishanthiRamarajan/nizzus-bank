import workerDefault from '../cloudflare-config';

export const WORKER_BASE = (import.meta.env.VITE_X42_API_URL || workerDefault).replace(/\/$/, '');
export const SERVICE_BASE = (import.meta.env.VITE_SERVICE_BASE || '').replace(/\/$/, '');
export const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY || '';
export const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
