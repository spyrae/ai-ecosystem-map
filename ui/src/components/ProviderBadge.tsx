import type { Provider } from '../types';

// Solid background colors — NOT opacity-based, readable on dark bg
const PROVIDER_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  claude:       { bg: '#3d2a0e', text: '#fbbf24', border: '#5c3d10' },
  codex:        { bg: '#0d3320', text: '#34d399', border: '#155e3b' },
  gemini:       { bg: '#0c2744', text: '#38bdf8', border: '#0e3a5e' },
  cursor:       { bg: '#2a1754', text: '#a78bfa', border: '#3b1f7a' },
  windsurf:     { bg: '#122044', text: '#60a5fa', border: '#1a3060' },
  copilot:      { bg: '#27272a', text: '#a1a1aa', border: '#3f3f46' },
  continue_dev: { bg: '#3b1a0a', text: '#fb923c', border: '#5c2a10' },
};

const PROVIDER_SHORT: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  copilot: 'Copilot',
  continue_dev: 'Continue',
};

interface ProviderBadgeProps {
  provider: Provider | string;
  size?: 'sm' | 'md';
}

export function ProviderBadge({ provider, size = 'sm' }: ProviderBadgeProps) {
  const style = PROVIDER_STYLES[provider] || PROVIDER_STYLES.copilot;
  const label = PROVIDER_SHORT[provider] || provider;
  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-[10px]'
    : 'px-2.5 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${sizeClasses}`}
      style={{
        backgroundColor: style.bg,
        color: style.text,
        borderWidth: '1px',
        borderColor: style.border,
      }}
    >
      {label}
    </span>
  );
}
