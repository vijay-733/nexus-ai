import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
  completed: boolean;
  currentStep: number;
  complete: () => void;
  setStep: (step: number) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      currentStep: 0,
      complete: () => set({ completed: true }),
      setStep: (step) => set({ currentStep: Math.max(0, Math.min(step, 2)) }),
      reset: () => {
        localStorage.removeItem('nexus-onboarding');
        set({ completed: false, currentStep: 0 });
      },
    }),
    { name: 'nexus-onboarding' }
  )
);
