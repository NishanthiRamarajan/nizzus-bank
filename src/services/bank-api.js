import { SERVICE_BASE } from '../config/api-config';
import { FIREBASE_PROJECT_ID } from '../config/api-config';
import { request } from './http';
import { firestoreBankApi } from './firestore-api';

export const bankApi = (path, options) => SERVICE_BASE
  ? request(SERVICE_BASE, path, options)
  : firestoreBankApi(path, options);
export const serviceConfigured = Boolean(SERVICE_BASE || FIREBASE_PROJECT_ID);
export const localFunctionConfigured = Boolean(SERVICE_BASE);
export const firestoreConfigured = Boolean(FIREBASE_PROJECT_ID);
