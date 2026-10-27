import React, { useState, useEffect } from 'react';
import { Palette, RotateCcw, Sliders, Sparkles, SunMedium } from 'lucide-react';
import { useTheme, THEMES, ThemeId, hexToRgb } from '../context/ThemeContext';

interface ThemeSettingsProps {
  compact?: boolean;
}

export const ThemeSettings: React.FC<ThemeSettingsProps> = ({ compact = false }) => {
  const {
    themeId,
    setThemeId,
    customColor,
    setCustomRgb,
    setCustomHsl,
    setCustomHex,
    setAmbientFilterParams,
    resetCustomColorToTheme,
    roomCanvasFilter,
    playBeep,
  } = useTheme();

  const [hexDraft, setHexDraft] = useState(customColor.hex);
  const [sliderMode, setSliderMode] = useState<'rgb' | 'hsl'>('rgb');

  useEffect(() => {
    setHexDraft(customColor.hex);
  }, [customColor.hex]);

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHexDraft(val);
    if (hexToRgb(val)) {
      setCustomHex(val);
    }
  };

  const rgbTuple = `${customColor.r}, ${customColor.g}, ${customColor.b}`;

  return (
    <div
      className="rounded-xl bg-[#0a0c10] border p-3.5 flex flex-col gap-3 font-mono-tabular transition-colors"
      style={{
        borderColor: 'var(--theme-border-color)',
        boxShadow: '0 0 18px var(--theme-glow-soft)',
      }}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Palette
            className="w-4 h-4 shrink-0"
            style={{ color: 'rgb(var(--theme-primary-rgb))' }}
          />
          <div>
            <div
              className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
              style={{
                color: 'rgb(var(--theme-primary-rgb))',
                textShadow: '0 0 8px var(--theme-glow-color)',
              }}
            >
              <span>RGB / HSL Theme & Ambient Filter Engine</span>
              {customColor.isCustomOverride && (
                <span className="text-[9px] px-1.5 py-0.5 bg-[#141923] border border-current">
                  [CUSTOM RGB]
                </span>
              )}
            </div>
            {!compact && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                Dynamically shifts room lighting, HUD borders, and status glow via CSS variables & hardware-accelerated filters.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            resetCustomColorToTheme();
            playBeep('switch');
          }}
          className="px-2 py-1 rounded bg-[#121621] hover:bg-[#192030] border border-slate-700 text-[10px] text-slate-300 flex items-center gap-1 cursor-pointer transition-colors"
          title="Reset RGB/HSL values to active preset default"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Quick Phosphor Preset Swatches */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(THEMES) as ThemeId[]).map((id) => {
          const item = THEMES[id];
          const isSelected = themeId === id && !customColor.isCustomOverride;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setThemeId(id)}
              className={`px-2.5 py-1 rounded text-[10px] border flex items-center gap-1.5 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-[#161c28] text-white font-bold'
                  : 'bg-[#0f131c] text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
              style={
                isSelected
                  ? {
                      borderColor: item.accentHex,
                      boxShadow: `0 0 10px ${item.accentHex}55`,
                    }
                  : undefined
              }
            >
              <span
                className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                style={{
                  backgroundColor: item.accentHex,
                  boxShadow: `0 0 6px ${item.accentHex}`,
                }}
              />
              <span>{item.shortLabel.toUpperCase()}</span>
            </button>
          );
        })}
      </div>

      {/* Native Color Picker + HEX Input + RGB/HSL Mode Switcher */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center bg-[#10141e] border border-slate-800/90 rounded-lg p-2.5">
        {/* Interactive Color Swatch Picker */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="color"
            value={customColor.hex}
            onChange={(e) => setCustomHex(e.target.value)}
            className="w-9 h-9 rounded bg-transparent border border-slate-700 cursor-pointer shrink-0"
            aria-label="Pick custom HUD and room ambient color"
          />
          <div className="min-w-0">
            <div className="text-[10px] text-slate-400 uppercase">Color Swatch</div>
            <div
              className="text-xs font-bold truncate"
              style={{ color: 'rgb(var(--theme-primary-rgb))' }}
            >
              rgb({rgbTuple})
            </div>
          </div>
        </label>

        {/* Direct HEX Code Input */}
        <div className="flex flex-col gap-1">
          <label htmlFor="theme-hex-input" className="text-[10px] text-slate-400 uppercase">
            HEX Color Code
          </label>
          <input
            id="theme-hex-input"
            type="text"
            value={hexDraft}
            onChange={handleHexInputChange}
            maxLength={7}
            placeholder="#4ade80"
            className="w-full bg-[#090c12] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-100 uppercase focus:outline-none"
            style={{ borderColor: 'var(--theme-border-color)' }}
          />
        </div>

        {/* Mode Toggle: RGB Sliders vs HSL Sliders */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <Sliders className="w-3 h-3" />
            <span>Channel Mode</span>
          </span>
          <div className="grid grid-cols-2 gap-1 bg-[#090c12] p-0.5 rounded border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setSliderMode('rgb');
                playBeep('tap');
              }}
              className={`py-1 text-[10px] rounded cursor-pointer transition-colors ${
                sliderMode === 'rgb'
                  ? 'bg-[#1b2234] text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              style={
                sliderMode === 'rgb'
                  ? { color: 'rgb(var(--theme-primary-rgb))' }
                  : undefined
              }
            >
              RGB (0-255)
            </button>
            <button
              type="button"
              onClick={() => {
                setSliderMode('hsl');
                playBeep('tap');
              }}
              className={`py-1 text-[10px] rounded cursor-pointer transition-colors ${
                sliderMode === 'hsl'
                  ? 'bg-[#1b2234] text-white font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              style={
                sliderMode === 'hsl'
                  ? { color: 'rgb(var(--theme-primary-rgb))' }
                  : undefined
              }
            >
              HSL (360°)
            </button>
          </div>
        </div>
      </div>

      {/* Interactive RGB or HSL Channel Sliders */}
      {sliderMode === 'rgb' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-[#0e121b] border border-slate-800/80 rounded-lg p-2.5">
          {/* Red Channel */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-red-400 font-bold">R · RED</span>
              <span className="text-slate-200">{customColor.r}</span>
            </div>
            <input
              type="range"
              min={0}
              max={255}
              value={customColor.r}
              onChange={(e) =>
                setCustomRgb(Number(e.target.value), customColor.g, customColor.b)
              }
              className="w-full accent-red-500 cursor-pointer"
            />
          </div>

          {/* Green Channel */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-emerald-400 font-bold">G · GREEN</span>
              <span className="text-slate-200">{customColor.g}</span>
            </div>
            <input
              type="range"
              min={0}
              max={255}
              value={customColor.g}
              onChange={(e) =>
                setCustomRgb(customColor.r, Number(e.target.value), customColor.b)
              }
              className="w-full accent-emerald-400 cursor-pointer"
            />
          </div>

          {/* Blue Channel */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-sky-400 font-bold">B · BLUE</span>
              <span className="text-slate-200">{customColor.b}</span>
            </div>
            <input
              type="range"
              min={0}
              max={255}
              value={customColor.b}
              onChange={(e) =>
                setCustomRgb(customColor.r, customColor.g, Number(e.target.value))
              }
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-[#0e121b] border border-slate-800/80 rounded-lg p-2.5">
          {/* Hue Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: 'rgb(var(--theme-primary-rgb))' }} className="font-bold">
                H · HUE ANGLE
              </span>
              <span className="text-slate-200">{customColor.h}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={360}
              value={customColor.h}
              onChange={(e) =>
                setCustomHsl(Number(e.target.value), customColor.s, customColor.l)
              }
              className="w-full cursor-pointer"
              style={{ accentColor: customColor.hex }}
            />
          </div>

          {/* Saturation Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-amber-300 font-bold">S · SATURATION</span>
              <span className="text-slate-200">{customColor.s}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={customColor.s}
              onChange={(e) =>
                setCustomHsl(customColor.h, Number(e.target.value), customColor.l)
              }
              className="w-full cursor-pointer"
              style={{ accentColor: customColor.hex }}
            />
          </div>

          {/* Lightness Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-cyan-300 font-bold">L · LIGHTNESS</span>
              <span className="text-slate-200">{customColor.l}%</span>
            </div>
            <input
              type="range"
              min={15}
              max={85}
              value={customColor.l}
              onChange={(e) =>
                setCustomHsl(customColor.h, customColor.s, Number(e.target.value))
              }
              className="w-full cursor-pointer"
              style={{ accentColor: customColor.hex }}
            />
          </div>
        </div>
      )}

      {/* Hardware-Accelerated Room Canvas Filter Controls (Brightness, Saturation, Drop-Shadow Glow) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-[#0e121b] border border-slate-800/80 rounded-lg p-2.5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-300 flex items-center gap-1">
              <SunMedium className="w-3 h-3" />
              <span>ROOM BRIGHTNESS</span>
            </span>
            <span style={{ color: 'rgb(var(--theme-primary-rgb))' }}>
              {Math.round(customColor.ambientBrightness * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.65}
            max={1.35}
            step={0.05}
            value={customColor.ambientBrightness}
            onChange={(e) =>
              setAmbientFilterParams({ ambientBrightness: parseFloat(e.target.value) })
            }
            className="w-full cursor-pointer"
            style={{ accentColor: customColor.hex }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-300">TINT SATURATION</span>
            <span style={{ color: 'rgb(var(--theme-primary-rgb))' }}>
              {Math.round(customColor.ambientSaturation * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={customColor.ambientSaturation}
            onChange={(e) =>
              setAmbientFilterParams({ ambientSaturation: parseFloat(e.target.value) })
            }
            className="w-full cursor-pointer"
            style={{ accentColor: customColor.hex }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-300 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>PHOSPHOR GLOW</span>
            </span>
            <span style={{ color: 'rgb(var(--theme-primary-rgb))' }}>
              {Math.round(customColor.ambientGlowIntensity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.05}
            value={customColor.ambientGlowIntensity}
            onChange={(e) =>
              setAmbientFilterParams({ ambientGlowIntensity: parseFloat(e.target.value) })
            }
            className="w-full cursor-pointer"
            style={{ accentColor: customColor.hex }}
          />
        </div>
      </div>

      {/* Live Injected CSS Variable & Filter Readout */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400 pt-0.5">
        <span className="truncate">
          <strong style={{ color: 'rgb(var(--theme-primary-rgb))' }}>
            --theme-primary-rgb:
          </strong>{' '}
          {rgbTuple} ·{' '}
          <strong style={{ color: 'rgb(var(--theme-primary-rgb))' }}>HSL:</strong>{' '}
          {customColor.h}°, {customColor.s}%, {customColor.l}%
        </span>
        <span
          className="px-1.5 py-0.5 border text-[9px] font-bold"
          style={{
            color: 'rgb(var(--theme-primary-rgb))',
            borderColor: 'var(--theme-border-color)',
            textShadow: '0 0 8px var(--theme-glow-color)',
          }}
        >
          [ACTIVE HUD GLOW PREVIEW]
        </span>
      </div>
      {!compact && (
        <div className="text-[9px] text-slate-500 truncate">
          FILTER: {roomCanvasFilter}
        </div>
      )}
    </div>
  );
};

export default ThemeSettings;
