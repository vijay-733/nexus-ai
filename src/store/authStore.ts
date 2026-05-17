import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../lib/api';

interface User {
  id: string;
  email: string;
  name?: string;
  plan: string;
  credits: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            null,
      token:           null,
      isAuthenticated: false,
      isLoading:       false,
      error:           null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await authApi.login(email, password);
          localStorage.setItem('nexus_token', token);
          set({ token, user, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Login failed', isLoading: false });
          throw err;
        }
      },

      register: async (email, password, name) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await authApi.register(email, password, name ?? email.split('@')[0]);
          localStorage.setItem('nexus_token', token);
          set({ token, user, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Registration failed', isLoading: false });
          throw err;
        }
      },

      logout: () => {
        localStorage.removeItem('nexus_token');
        set({ user: null, token: null, isAuthenticated: false });
      },

      setUser: (user) => set({ user }),
      clearError: () => set({ error: null }),

      refreshUser: async () => {
        if (!localStorage.getItem('nexus_token')) return;
        try {
          const { user } = await authApi.me();
          set({ user });
        } catch {
          // silently ignore — stale data is better than crashing
        }
      },
    }),
    {
      name:    'nexus-auth',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
