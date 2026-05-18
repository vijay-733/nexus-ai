import { useState } from 'react';
import { motion } from 'motion/react';
import { Settings as SettingsIcon, Key, Bell, Monitor, Shield, Trash2, Save, Eye, EyeOff, Sun, Moon, SunMoon } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useAppStore } from '../store/appStore';
import type { Theme } from '../store/appStore';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { cn } from '../lib/utils';

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-[var(--color-nexus-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--color-text-primary)]">{label}</p>
        {description && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'w-10 h-5 rounded-full transition-all duration-200 relative',
        checked ? 'bg-[var(--color-nexus-accent)]' : 'bg-[var(--color-nexus-muted)]'
      )}
    >
      <span className={cn(
        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200',
        checked ? 'left-[22px]' : 'left-0.5'
      )} />
    </button>
  );
}

const THEME_OPTIONS: { id: Theme; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'dark',   label: 'Dark',   icon: Moon,    description: 'Classic dark workspace' },
  { id: 'light',  label: 'Light',  icon: Sun,     description: 'Clean light interface'  },
  { id: 'system', label: 'System', icon: SunMoon, description: 'Follows OS preference'  },
];

const PREFS_KEY = 'nexus_prefs';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); } catch { return {}; }
}

export default function Settings() {
  const { user, logout } = useAuthStore();
  const { theme, setTheme } = useAppStore();
  const prefs = loadPrefs();
  const [apiKey,        setApiKey]        = useState<string>(localStorage.getItem('nexus_openai_key') ?? '');
  const [showKey,       setShowKey]       = useState(false);
  const [notifications, setNotifications] = useState<boolean>(prefs.notifications ?? true);
  const [streamOutput,  setStreamOutput]  = useState<boolean>(prefs.streamOutput  ?? true);
  const [autoSave,      setAutoSave]      = useState<boolean>(prefs.autoSave      ?? true);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ notifications, streamOutput, autoSave }));
    if (apiKey) localStorage.setItem('nexus_openai_key', apiKey);
    else localStorage.removeItem('nexus_openai_key');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Settings</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Configure your Nexus AI workspace</p>
      </div>

      {/* Account */}
      <Section title="Account" icon={Shield}>
        <FieldRow label="Email" description="Your account email address">
          <Badge variant="outline">{user?.email ?? '—'}</Badge>
        </FieldRow>
        <FieldRow label="Plan" description="Your current subscription">
          <Badge variant="accent">{user?.plan ?? 'free'}</Badge>
        </FieldRow>
        <FieldRow label="Credits" description="Remaining AI credits">
          <span className="text-sm font-mono text-[var(--color-nexus-accent)]">
            {user?.credits?.toLocaleString() ?? '—'}
          </span>
        </FieldRow>
      </Section>

      {/* Appearance */}
      <Section title="Appearance" icon={Monitor}>
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-text-muted)]">Theme</p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(({ id, label, icon: Icon, description }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className={cn(
                    'flex flex-col items-center gap-2 px-3 py-3.5 rounded-[11px] border transition-all duration-150 text-center',
                    active
                      ? 'border-[var(--color-nexus-accent)] bg-[var(--color-nexus-accent-3)]'
                      : 'border-[var(--color-nexus-border)] bg-[var(--color-nexus-elevated)] hover:border-[var(--color-nexus-border-2)]'
                  )}
                >
                  <Icon
                    size={16}
                    style={{ color: active ? 'var(--color-nexus-accent)' : 'var(--color-text-muted)' }}
                  />
                  <div>
                    <p
                      className="text-xs font-semibold"
                      style={{ color: active ? 'var(--color-nexus-accent)' : 'var(--color-text-primary)' }}
                    >
                      {label}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-tight">
                      {description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* API Keys */}
      <Section title="API Keys" icon={Key}>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            OpenAI API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full h-9 px-3 pr-9 rounded-lg text-sm bg-[var(--color-nexus-elevated)] border border-[var(--color-nexus-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-nexus-accent)] focus:outline-none font-mono"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Stored locally in your browser. Never sent to our servers.
          </p>
        </div>
      </Section>

      {/* Preferences */}
      <Section title="Preferences" icon={Bell}>
        <FieldRow label="Stream output" description="Show agent responses in real-time">
          <Toggle checked={streamOutput} onChange={setStreamOutput} />
        </FieldRow>
        <FieldRow label="Auto-save sessions" description="Automatically save completed sessions">
          <Toggle checked={autoSave} onChange={setAutoSave} />
        </FieldRow>
        <FieldRow label="Notifications" description="Desktop notifications for completed tasks">
          <Toggle checked={notifications} onChange={setNotifications} />
        </FieldRow>
      </Section>

      {/* Save */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <Button variant="danger" size="sm" onClick={logout}>
          <Trash2 size={13} />
          Sign Out
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave}>
          <Save size={13} />
          {saved ? 'Saved!' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
