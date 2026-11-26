import type { ReactNode } from 'react';
import {
  Button,
  Header,
  Label,
  ListBox,
  ListBoxSection,
  Select,
  Slider,
  Switch,
  Tabs,
} from '@heroui/react';
import { Bot, Moon, Sun, Swords, Users } from 'lucide-react';
import type { GameMode } from '../games/contracts';
import { useTheme } from '../theme/ThemeContext';

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
        className="min-h-[38px] max-sm:min-h-[44px] w-full bg-[var(--field-background)] text-[var(--field-foreground)] border border-[var(--field-border)] rounded-lg px-3 py-1.5 text-xs font-medium flex items-center justify-between gap-2 transition-colors hover:border-[var(--accent)]/60"
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
 * HeroUI v3 药丸开关（修复 Switch.Content 必须包裹 Switch.Control 才能响应点击的机制）：
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
  const tabClass = `${
    compact ? 'px-2.5' : 'px-3.5'
  } !h-[30px] !rounded-full text-xs font-bold whitespace-nowrap inline-flex items-center justify-center gap-1.5`;

  return (
    <Tabs
      selectedKey={gameMode}
      onSelectionChange={(key) => {
        const val = String(key);
        if (val === 'single' || val === 'multi' || val === 'brawl') {
          onChange(val);
        }
      }}
      className={className}
    >
      <Tabs.ListContainer>
        <Tabs.List
          aria-label="切换游戏模式"
          className="h-9 bg-[var(--surface-secondary)] border border-[var(--border)] p-0.5 !rounded-full inline-flex items-center"
        >
          <Tabs.Tab id="single" data-testid={`${testIdPrefix}-mode-single`} className={tabClass}>
            <Bot className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            单人游戏
            <Tabs.Indicator className="!rounded-full" />
          </Tabs.Tab>
          <Tabs.Tab id="multi" data-testid={`${testIdPrefix}-mode-multi`} className={tabClass}>
            <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            多人游戏
            <Tabs.Indicator className="!rounded-full" />
          </Tabs.Tab>
          <Tabs.Tab id="brawl" data-testid={`${testIdPrefix}-mode-brawl`} className={tabClass}>
            <Swords className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            AI 乱斗
            <Tabs.Indicator className="!rounded-full" />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
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
