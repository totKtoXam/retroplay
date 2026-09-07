'use client';
import { Mountain, Sparkles } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function StylePicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`style-picker ${compact ? 'compact' : ''}`}>
      <span className="style-picker-label">Визуальный стиль</span>
      <Tabs value={value} onValueChange={onChange}>
        <TabsList aria-label="Визуальный стиль игры">
          <TabsTrigger
            value="classic"
            disabled={disabled}
            className="style-option style-classic"
          >
            <Mountain size={compact ? 18 : 28} />
            <span>
              <strong>Tactical</strong>
              {!compact && (
                <small>Чёткие формы · контраст · быстрый темп</small>
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="anime"
            disabled={disabled}
            className="style-option style-anime"
          >
            <Sparkles size={compact ? 18 : 28} />
            <span>
              <strong>Аниме</strong>
              {!compact && <small>Небесные сады · рисованные тени</small>}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
