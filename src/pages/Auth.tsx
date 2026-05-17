import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle, User } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/utils';

export default function Auth() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const { login, register, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name);
    } catch { /* error handled by store */ }
  };

  return (
    <div className="min-h-screen bg-[var(--color-nexus-dark)] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[var(--color-nexus-glow-lg)] blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[var(--color-nexus-accent-3)] border border-[rgba(0,229,160,0.25)] flex items-center justify-center mb-4 glow-accent">
            <Cpu size={22} className="text-[var(--color-nexus-accent)]" />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            Nexus <span className="gradient-text">AI</span>
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}
          </p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-6 space-y-5">
          {/* Tab toggle */}
          <div className="flex gap-1 p-1 bg-[var(--color-nexus-elevated)] rounded-lg">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); clearError(); setName(''); }}
                className={cn(
                  'flex-1 py-1.5 rounded-md text-sm font-medium transition-all duration-150',
                  m === mode
                    ? 'bg-[var(--color-nexus-surface)] text-[var(--color-text-primary)] shadow'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                )}
              >
                {m === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name — register only */}
            <AnimatePresence>
              {mode === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-1.5 overflow-hidden"
                >
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">Name</label>
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required={mode === 'register'}
                      minLength={2}
                      placeholder="Your name"
                      className={cn(
                        'w-full h-9 pl-9 pr-3 rounded-lg text-sm',
                        'bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)]',
                        'text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]',
                        'focus:border-[var(--color-nexus-accent)] focus:outline-none transition-colors'
                      )}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className={cn(
                    'w-full h-9 pl-9 pr-3 rounded-lg text-sm',
                    'bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)]',
                    'text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]',
                    'focus:border-[var(--color-nexus-accent)] focus:outline-none transition-colors'
                  )}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="••••••••"
                  className={cn(
                    'w-full h-9 pl-9 pr-9 rounded-lg text-sm',
                    'bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)]',
                    'text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]',
                    'focus:border-[var(--color-nexus-accent)] focus:outline-none transition-colors',
                    mode === 'register' && password.length > 0 && password.length < 8 && 'border-[var(--color-nexus-amber)]'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {mode === 'register' && password.length > 0 && password.length < 8 && (
                <p className="text-[10px] text-[var(--color-nexus-amber)]">
                  Password must be at least 8 characters ({8 - password.length} more needed)
                </p>
              )}
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 text-xs text-[var(--color-nexus-red)] bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.15)] rounded-lg px-3 py-2"
                >
                  <AlertCircle size={13} />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={isLoading}
              className="w-full"
            >
              {mode === 'login' ? 'Sign In' : 'Create Account'}
              <ArrowRight size={14} />
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--color-text-muted)] mt-4">
          Nexus AI — Distributed Agent Operating System
        </p>
      </motion.div>
    </div>
  );
}
