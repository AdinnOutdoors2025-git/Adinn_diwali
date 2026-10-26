import { BD, ClientRecord, DistributionRow, User, VerticalType } from '../types';

const API_BASE_URL = '/api';

export class ApiError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('adinn_diwali_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type');
  const isLogin = new URL(response.url).pathname === `${API_BASE_URL}/auth/login`;
  let data: any = null;

  if (response.status === 401) {
    localStorage.removeItem('adinn_diwali_token');
    localStorage.removeItem('adinn_diwali_user');
  }

  if (contentType?.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      console.error('API returned invalid JSON', { url: response.url, status: response.status });
      throw new ApiError('Unexpected server error. Please try again.');
    }
  }

  if (!response.ok || data === null) {
    // Log metadata only: response bodies can contain HTML, stack traces or secrets.
    console.error('API request failed', { url: response.url, status: response.status, contentType });
    if (response.status === 404) {
      throw new ApiError(isLogin ? 'Authentication endpoint unavailable.' : 'Requested endpoint unavailable.');
    }
    if ([502, 503, 504].includes(response.status) || (response.status === 500 && !data)) {
      throw new ApiError('Unable to connect to the server. Please try again.');
    }
    if (isLogin) {
      if (response.status === 401) throw new ApiError('Invalid credentials.');
      if (response.status === 403) throw new ApiError('This account does not have access. Please contact your administrator.');
      if (response.status === 400) throw new ApiError('Please enter a valid email and password.');
      throw new ApiError('Unexpected server error. Please try again.');
    }
    const message = typeof data?.message === 'string' && !/[<>]/.test(data.message)
      ? data.message
      : 'Unexpected server error. Please try again.';
    throw new ApiError(message, typeof data?.code === 'string' ? data.code : undefined);
  }

  return data as T;
};

export const api = {
  // Auth
  async login(email: string, password: string) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      console.error('Authentication request could not reach the server', { endpoint: `${API_BASE_URL}/auth/login` });
      throw new ApiError('Unable to connect to the server. Please try again.');
    }
    const data = await handleResponse<{ success: boolean; token: string; user: User; message: string }>(res);
    if (!data.success || typeof data.token !== 'string' || !data.token ||
        !data.user || typeof data.user.id !== 'string' || typeof data.user.name !== 'string' ||
        typeof data.user.email !== 'string' || !['STAFF', 'CMD'].includes(data.user.role)) {
      console.error('Authentication response did not match the expected contract', { status: res.status });
      throw new ApiError('Unexpected server error. Please try again.');
    }
    return data;
  },

  async getMe() {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; user: User }>(res);
  },

  // BDs
  async getBDs() {
    const res = await fetch(`${API_BASE_URL}/bds`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; count: number; data: BD[] }>(res);
  },

  async createBD(name: string, email: string) {
    const res = await fetch(`${API_BASE_URL}/bds`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, email }),
    });
    return handleResponse<{ success: boolean; message: string; data: BD }>(res);
  },

  async deleteBD(id: string) {
    const res = await fetch(`${API_BASE_URL}/bds/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Clients (Add Page: Management only, NO distribution)
  async getClients(vertical: VerticalType, bdId: string, search = '', page = 1, limit = 10) {
    const params = new URLSearchParams({
      vertical,
      bd: bdId,
      page: page.toString(),
      limit: limit.toString(),
    });
    if (search.trim()) {
      params.append('search', search.trim());
    }

    const res = await fetch(`${API_BASE_URL}/clients?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<{
      success: boolean;
      data: ClientRecord[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }>(res);
  },

  async createClient(data: { vertical: VerticalType; bd: string; name: string; mobile: string; email?: string; confirmExisting?: boolean }) {
    const res = await fetch(`${API_BASE_URL}/clients`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean; message: string; data: ClientRecord }>(res);
  },

  async updateClient(id: string, data: { name?: string; mobile?: string; email?: string }) {
    const res = await fetch(`${API_BASE_URL}/clients/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean; message: string; data: ClientRecord }>(res);
  },

  async deleteClient(id: string) {
    const res = await fetch(`${API_BASE_URL}/clients/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async bulkImportClients(vertical: VerticalType, bd: string, records: Array<{ name: string; mobile: string; email?: string }>) {
    const res = await fetch(`${API_BASE_URL}/clients/bulk-import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ vertical, bd, records }),
    });
    return handleResponse<{
      success: boolean;
      message: string;
      summary: {
        totalReceived: number;
        successful: number;
        duplicates: number;
        invalid: number;
        skipped: number;
      };
      errors?: string[];
    }>(res);
  },

  getSampleTemplateUrl() {
    return `${API_BASE_URL}/clients/sample-template`;
  },

  // Distributions (Entry Page: Annual Sweet Distribution Tracking)
  async getDistributions(params: {
    year: number;
    vertical?: string;
    bd?: string;
    search?: string;
    status?: 'ALL' | 'GIVEN' | 'NOT_GIVEN';
    page?: number;
    limit?: number;
  }) {
    const query = new URLSearchParams({
      year: params.year.toString(),
      page: (params.page || 1).toString(),
      limit: (params.limit || 10).toString(),
      status: params.status || 'ALL',
    });

    if (params.vertical && params.vertical !== 'ALL') {
      query.append('vertical', params.vertical);
    }
    if (params.bd && params.bd !== 'ALL') {
      query.append('bd', params.bd);
    }
    if (params.search && params.search.trim()) {
      query.append('search', params.search.trim());
    }

    const res = await fetch(`${API_BASE_URL}/distributions?${query.toString()}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<{
      success: boolean;
      data: DistributionRow[];
      selectedYear: number;
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }>(res);
  },

  async createDistribution(data: {
    clientId: string;
    year: number;
    vertical: VerticalType;
    bd: string;
    notes?: string;
  }) {
    const res = await fetch(`${API_BASE_URL}/distributions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<{ success: boolean; message: string; data: any }>(res);
  },

  async revertDistribution(id: string, reason: string) {
    const res = await fetch(`${API_BASE_URL}/distributions/${id}/revert`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ reason }),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },
};
