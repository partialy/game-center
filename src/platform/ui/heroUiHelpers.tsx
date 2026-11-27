import type { ReactNode } from 'react';
import {
  Button,
  Header,
  Input,
  Label,
  ListBox,
  ListBoxSection,
  Select,
  Slider,
  Switch,
  Tabs,
} from '@heroui/react';
import { Bot, Minus, Moon, Plus, Sun, Swords, Users } from 'lucide-react';
import type { GameMode } from '../games/contracts';
import { useTheme } from '../theme/ThemeContext';
import { stepNumericValue } from './numberStepperMath';

export interface SelectOptionItem {
  value: string;
  label: string;
  description?: string;
}

export interface SelectOptionGroup {
  title: string;
  options: SelectOptionItem[];
}

interface AppSelectProps {
  ariaLabel: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options?: SelectOptionItem[];
  groups?: SelectOptionGroup[];
  placeholder?: string;
  isDisabled?: boolean;
  className?: string;
  testId?: string;
}

/**
 * HeroUI v3 统一 Select 封装：
 * - 兼容单列表与分组选项（如自定义 AI 脚本 + 内置 AI 模型）
 * - 自动保证桌面 >= 38px / 触控 >= 44px 热区，支持键盘方向键与无障碍 ARIA
 */
export function AppSelect({
  ariaLabel,
  label,
  value,
  onChange,
  options = [],
  groups,
  placeholder = '请选择',
  isDisabled = false,
  className = '',
  testId,
}: AppSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      value={value}
      onChange={(nextKey) => {
        if (nextKey !== null && nextKey !== undefined) {
          onChange(String(nextKey));
        }
      }}
      isDisabled={isDisabled}
      className={`w-full ${className}`}
    >
      {label && (
        <Label className="text-xs font-semibold text-[var(--foreground)] mb-1 block">
          {label}
        </Label>
      )}
      <Select.Trigger
        data-testid={testId}
        className="min-h-[38px] max-sm:min-h-[44px] w-full bg-[var(--field-background)] text-[var(--field-foreground)] border border-[var(--field-border)] rounded-xl px-3 py-1.5 text-xs font-medium flex items-center justify-between gap-2 transition-colors hover:border-[var(--accent)]/60"
      >
        <Select.Value className="truncate text-left">
          {({ defaultChildren }) => defaultChildren ?? placeholder}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="z-[90] bg-[var(--overlay)] text-[var(--overlay-foreground)] border border-[var(--border)] rounded-xl shadow-xl max-h-72 overflow-y-auto p-1">
        <ListBox className="outline-none space-y-0.5">
          {groups
            ? groups.map((group) => (
                <ListBoxSection key={group.title} className="py-1">
                  <Header className="px-2.5 py-1 text-[11px] font-bold text-[var(--muted)] tracking-wide">
                    {group.title}
                  </Header>
                  {group.options.map((opt) => (
                    <ListBox.Item
                      key={opt.value}
                      id={opt.value}
                      textValue={opt.label}
                      className="min-h-[38px] max-sm:min-h-[44px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--overlay-foreground)] flex items-center justify-between gap-2 cursor-pointer data-[hovered]:bg-[var(--surface-secondary)] data-[selected]:bg-[var(--accent)]/14 data-[selected]:text-[var(--accent)] data-[selected]:font-bold"
                    >
                      <span className="truncate">{opt.label}</span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBoxSection>
              ))
            : options.map((opt) => (
                <ListBox.Item
                  key={opt.value}
                  id={opt.value}
                  textValue={opt.label}
                  className="min-h-[38px] max-sm:min-h-[44px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--overlay-foreground)] flex items-center justify-between gap-2 cursor-pointer data-[hovered]:bg-[var(--surface-secondary)] data-[selected]:bg-[var(--accent)]/14 data-[selected]:text-[var(--accent)] data-[selected]:font-bold"
                >
                  <span className="truncate">{opt.label}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

interface AppSwitchProps {
  isSelected: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  label?: ReactNode;
  isDisabled?: boolean;
  testId?: string;
}

/**
 * HeroUI v3 药丸开关（Switch.Content 包裹 Switch.Control 以完整响应点击）：
 * - 药丸轨道（rounded-full，44×24px）+ 圆形滑块（rounded-full，18×18px）
 * - 开启态同步全局强调色 --accent，关闭态保持高对比边框与轨道
 */
export function AppSwitch({
  isSelected,
  onChange,
  ariaLabel,
  label,
  isDisabled = false,
  testId,
}: AppSwitchProps) {
  return (
    <Switch
      aria-label={ariaLabel}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      data-testid={testId}
      className="inline-flex items-center"
    >
      <Switch.Content className="inline-flex items-center gap-2.5 min-h-[36px] max-sm:min-h-[44px] cursor-pointer select-none data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed">
        <Switch.Control
          className={`relative !w-11 !h-6 !rounded-full !p-[2px] border inline-flex items-center shrink-0 !transition-colors !duration-200 ${
            isSelected
              ? '!bg-[var(--accent)] !border-[var(--accent)]'
              : '!bg-black/15 dark:!bg-white/20 !border-[var(--border)]'
          }`}
        >
          <Switch.Thumb
            className={`!w-[18px] !h-[18px] !rounded-full !bg-white !start-0 !ms-0 shadow-sm block !transition-transform !duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isSelected ? '!translate-x-[20px]' : '!translate-x-0'
            }`}
          />
        </Switch.Control>
        {label && (
          <Label className="text-xs font-medium text-[var(--foreground)] cursor-pointer">
            {label}
          </Label>
        )}
      </Switch.Content>
    </Switch>
  );
}

interface AppNumberStepperProps {
  id?: string;
  ariaLabel: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  unit?: string;
  isDisabled?: boolean;
  hasError?: boolean;
  size?: 'sm' | 'md';
  testId?: string;
}

/**
 * 游戏 App 风格圆形加减步进器：
 * - 两侧为圆形 − / + 按钮（桌面 32px，移动端 40px 触控友好），中间支持直接键入精确数值
 * - 自动按步长防浮点精度漂移并钳制 min/max 边界
 */
export function AppNumberStepper({
  id,
  ariaLabel,
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
  unit,
  isDisabled = false,
  hasError = false,
  size = 'md',
  testId,
}: AppNumberStepperProps) {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const isFiniteVal = typeof value === 'number' && Number.isFinite(value);
  const atMin = isFiniteVal && typeof min === 'number' && value <= min + 1e-9;
  const atMax = isFiniteVal && typeof max === 'number' && value >= max - 1e-9;

  const isCompact = size === 'sm';
  const btnClass = isCompact
    ? '!w-7 !h-7 max-sm:!w-9 max-sm:!h-9 !min-w-[28px] max-sm:!min-w-[36px] !p-0 !rounded-full shrink-0'
    : '!w-8 !h-8 max-sm:!w-10 max-sm:!h-10 !min-w-[32px] max-sm:!min-w-[40px] !p-0 !rounded-full shrink-0';

  const handleStep = (deltaSteps: number) => {
    if (isDisabled) return;
    const next = stepNumericValue({
      value,
      deltaSteps,
      step: safeStep,
      min,
      max,
      integer,
    });
    onChange(next);
  };

  return (
    <div
      data-testid={testId}
      className={`flex items-center gap-1.5 rounded-full border bg-[var(--field-background)] px-1 ${
        isCompact ? 'h-9 max-sm:h-11' : 'h-10 max-sm:h-12'
      } ${
        hasError
          ? 'border-red-500 ring-1 ring-red-500/25'
          : 'border-[var(--field-border)] focus-within:border-[var(--accent)]'
      } ${isDisabled ? 'opacity-50' : ''} transition-colors`}
    >
      <Button
        variant="secondary"
        size="sm"
        isIconOnly
        isDisabled={isDisabled || atMin}
        data-testid={testId ? `${testId}-dec` : undefined}
        aria-label={`减少 ${ariaLabel}`}
        onPress={() => handleStep(-1)}
        className={btnClass}
      >
        <Minus className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden="true" />
      </Button>

      <div className="flex-1 min-w-0 flex items-center justify-center gap-1 px-1">
        <Input
          id={id}
          aria-label={ariaLabel}
          type="number"
          inputMode={integer ? 'numeric' : 'decimal'}
          value={isFiniteVal ? String(value) : ''}
          min={min}
          max={max}
          step={safeStep}
          disabled={isDisabled}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw === '' ? Number.NaN : Number(raw);
            onChange(parsed);
          }}
          className={`no-spin-input w-full min-w-[36px] text-center bg-transparent border-0 shadow-none outline-none focus:ring-0 p-0 font-mono-num font-bold text-[var(--field-foreground)] ${
            isCompact ? 'text-xs' : 'text-sm'
          }`}
        />
        {unit && (
          <span className="text-[11px] font-medium text-[var(--muted)] whitespace-nowrap shrink-0 select-none">
            {unit}
          </span>
        )}
      </div>

      <Button
        variant="secondary"
        size="sm"
        isIconOnly
        isDisabled={isDisabled || atMax}
        data-testid={testId ? `${testId}-inc` : undefined}
        aria-label={`增加 ${ariaLabel}`}
        onPress={() => handleStep(1)}
        className={btnClass}
      >
        <Plus className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden="true" />
      </Button>
    </div>
  );
}

export interface PillSegmentOption {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  testId?: string;
}

interface PillSegmentedControlProps {
  ariaLabel: string;
  selectedKey: string;
  onChange: (key: string) => void;
  options: PillSegmentOption[];
  fullWidth?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * 全站统一药丸分段器（rounded-full 外壳 + 药丸滑块指示器），适用于模式、操控、主题、规则子分组等。
 */
export function PillSegmentedControl({
  ariaLabel,
  selectedKey,
  onChange,
  options,
  fullWidth = false,
  compact = false,
  className = '',
}: PillSegmentedControlProps) {
  return (
    <Tabs
      selectedKey={selectedKey}
      onSelectionChange={(key) => onChange(String(key))}
      className={`${fullWidth ? 'w-full' : '!w-fit'} ${className}`}
    >
      <Tabs.ListContainer className={fullWidth ? 'w-full' : '!w-fit'}>
        <Tabs.List
          aria-label={ariaLabel}
          className={`h-9 bg-[var(--surface-secondary)] border border-[var(--border)] p-0.5 !rounded-full ${
            fullWidth ? 'w-full flex items-center' : '!w-fit inline-flex items-center'
          }`}
        >
          {options.map((opt) => (
            <Tabs.Tab
              key={opt.id}
              id={opt.id}
              data-testid={opt.testId}
              className={`${
                fullWidth ? 'flex-1' : '!w-auto flex-none'
              } ${
                compact ? 'px-2.5' : 'px-3.5'
              } !h-[30px] !rounded-full text-xs font-bold whitespace-nowrap inline-flex items-center justify-center gap-1.5`}
            >
              {opt.icon}
              <span>{opt.label}</span>
              {opt.badge}
              <Tabs.Indicator className="!rounded-full" />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

interface AppSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  testId?: string;
}

export function AppSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  testId,
}: AppSliderProps) {
  return (
    <Slider
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      onChange={(next) => {
        const num = Array.isArray(next) ? next[0] : next;
        if (typeof num === 'number' && Number.isFinite(num)) {
          onChange(num);
        }
      }}
      data-testid={testId}
      className="w-full space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold text-[var(--foreground)]">{label}</Label>
        <Slider.Output className="font-mono-num text-xs font-bold text-[var(--accent)]">
          {() => `${value}${unit}`}
        </Slider.Output>
      </div>
      <Slider.Track className="min-h-[28px] max-sm:min-h-[36px] flex items-center">
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  );
}

interface ModeTabsProps {
  gameMode: GameMode;
  onChange: (mode: GameMode) => void;
  testIdPrefix: 'lobby' | 'prematch' | 'settings';
  compact?: boolean;
  className?: string;
}

/**
 * 全局统一药丸形态（rounded-full）「单人游戏 / 多人游戏 / AI 乱斗」HeroUI Tabs 分段器。
 * 统一 h-9（36px）高度，与圆形主题按钮及「AI工坊」按钮精准对齐。
 */
export function ModeTabs({
  gameMode,
  onChange,
  testIdPrefix,
  compact = false,
  className = '',
}: ModeTabsProps) {
  return (
    <PillSegmentedControl
      ariaLabel="切换游戏模式"
      selectedKey={gameMode}
      compact={compact}
      className={className}
      onChange={(val) => {
        if (val === 'single' || val === 'multi' || val === 'brawl') {
          onChange(val);
        }
      }}
      options={[
        {
          id: 'single',
          label: '单人游戏',
          icon: <Bot className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
          testId: `${testIdPrefix}-mode-single`,
        },
        {
          id: 'multi',
          label: '多人游戏',
          icon: <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
          testId: `${testIdPrefix}-mode-multi`,
        },
        {
          id: 'brawl',
          label: 'AI 乱斗',
          icon: <Swords className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
          testId: `${testIdPrefix}-mode-brawl`,
        },
      ]}
    />
  );
}

/**
 * 全局圆形浅色 / 深色主题切换按钮（36×36 正圆，与 AI工坊及药丸分段器等高对齐）。
 */
export function ThemeQuickToggle({
  testId = 'theme-quick-toggle',
  showLabel = false,
}: {
  testId?: string;
  showLabel?: boolean;
}) {
  const { resolvedMode, toggleLightDark } = useTheme();
  const isDark = resolvedMode === 'dark';

  return (
    <Button
      variant="secondary"
      size="sm"
      isIconOnly={!showLabel}
      data-testid={testId}
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      onPress={toggleLightDark}
      className={
        showLabel
          ? 'h-9 px-3 !rounded-full whitespace-nowrap shrink-0'
          : '!w-9 !h-9 !min-w-[36px] !p-0 !rounded-full shrink-0'
      }
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
      )}
      {showLabel && <span>{isDark ? '浅色' : '深色'}</span>}
    </Button>
  );
}
