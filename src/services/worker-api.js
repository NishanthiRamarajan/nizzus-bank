import { WORKER_BASE } from '../config/api-config';
import { request } from './http';

export const workerApi = (path, options) => request(WORKER_BASE, `/api/v1${path}`, options);
export const workerBase = WORKER_BASE;
